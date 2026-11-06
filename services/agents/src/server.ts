import cors from "@fastify/cors"
import { HealthResponse } from "@fairtown/shared/api"
import { redact } from "./redact"
import { z } from "zod"
import type { HealthExtras } from "./health"
import Fastify, { type FastifyError, type FastifyInstance } from "fastify"
import type { AiGateway } from "./ai/gateway"
import type { ArkivStore } from "./arkiv/ArkivStore"
import type { ChainAdapter } from "./chain/types"
import type { AgentsConfig } from "./config"
import { registerDisputeRoutes, type DisputeDeps } from "./handover/disputes"
import { registerMarketRoutes, type MarketDeps } from "./market/routes"
import { registerHandoverRoutes, type HandoverDeps } from "./handover/routes"
import { registerHumanRoutes, type HumanDeps } from "./humans/routes"
import type { Director } from "./director/director"
import { registerDirectorRoutes } from "./director/routes"
import { registerIntelRoute } from "./addons/hedera/intel"
import { registerListingRoutes, type ListingDeps } from "./listing/routes"
import { registerAgentRoutes } from "./runtime/routes"
import { registerCallers } from "./callers"
import type { AgentRuntime } from "./runtime/runtime"

export type AppDeps = { config: AgentsConfig; chain: ChainAdapter; arkiv: ArkivStore; ai: Pick<AiGateway, "health">; listing?: Omit<ListingDeps, "config" | "chain">; runtime?: AgentRuntime; disputes?: DisputeDeps; market?: MarketDeps; handover?: HandoverDeps; humans?: HumanDeps; director?: Director; intel?: Parameters<typeof registerIntelRoute>[1]; health?: () => Promise<HealthExtras>; logger?: boolean }

const Dep = z.object({ ok: z.boolean(), detail: z.string() })
const ExtendedHealth = HealthResponse.extend({
  status: z.enum(["ok", "degraded", "down"]),
  degraded: z.array(z.string()),
  relay: Dep.optional(),
  ledger: Dep.optional(),
  feed: Dep.optional(),
  runtime: Dep.optional(),
  llm: Dep.optional(),
  vision: Dep.optional(),
})

export function corsOrigins(c: { PUBLIC_WEB_URL?: string; CORS_ORIGINS?: string | undefined }): string[] {
  const list = ["http://localhost:8080", "http://127.0.0.1:8080", ...(c.PUBLIC_WEB_URL ? [c.PUBLIC_WEB_URL] : []), ...(c.CORS_ORIGINS ?? "").split(",")]
  return [...new Set(list.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean))]
}

export const REDACT = ["req.headers.authorization", 'req.headers["x-fairtown-bot"]', "*.privateKey", "*.mnemonic", "*.accessKey", "*.apiKey"]

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    bodyLimit: 12 * 1024 * 1024, // up to 3 phone photos or a voice note as base64
    ...(deps.config.TRUST_PROXY ? { trustProxy: deps.config.TRUST_PROXY } : {}),
    logger: deps.logger === false ? false : { level: "info", redact: { paths: REDACT, censor: "[redacted]" } },
  })
  // Before any route: who is calling (direct, or the Telegram bot for one Telegram user). ICR-012.
  registerCallers(app, deps.config.TELEGRAM_SERVICE_TOKEN)

  // The web app (S3) calls this API from another origin: allow it explicitly, never by reflecting any origin.
  void app.register(cors, { origin: corsOrigins(deps.config), allowedHeaders: ["Content-Type", "Authorization", "PAYMENT-SIGNATURE"], exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] })

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status === 500) app.log.error({ err: redact(err), url: req.url.split("?")[0] }, "request failed")
    reply.status(status).send({ error: { code: err.code ?? "internal", message: status === 500 ? "Internal error" : err.message } })
  })
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: "not_found", message: `${req.method} ${req.url} not found` } })
  })

  app.get("/api/health", async () => {
    let chain: { ok: boolean; detail: string }
    try {
      chain = { ok: true, detail: `${deps.chain.mode} at block ${await deps.chain.blockNumber()}` }
    } catch (e) {
      chain = { ok: false, detail: e instanceof Error ? e.message : "unreachable" }
    }
    let arkiv: { ok: boolean; detail: string } = { ok: true, detail: deps.arkiv.mode }
    const live = deps.arkiv as { checkChain?: () => Promise<{ chainId: number; writer: string }> }
    if (live.checkChain) {
      try {
        const c = await live.checkChain()
        arkiv = { ok: true, detail: `live, Rabdi ${c.chainId}, writer ${c.writer}` }
      } catch {
        arkiv = { ok: false, detail: "Arkiv RPC unreachable" }
      }
    }
    const ai = await deps.ai.health()
    const extras = deps.health ? await deps.health() : undefined
    // Only the chain is fatal: Arkiv, AI, relay and the ledger all degrade (see each detail).
    const { addons, ...rest } = extras ?? { addons: {} }
    const parts: Record<string, { ok: boolean }> = { arkiv, ai, ...rest, ...Object.fromEntries(Object.entries(addons).map(([k, v]) => [`addon:${k}`, v])) }
    const degraded = Object.entries(parts).filter(([, v]) => !v.ok).map(([k]) => k)
    const status = !chain.ok ? "down" : degraded.length ? "degraded" : "ok"
    return ExtendedHealth.parse({ ok: chain.ok && arkiv.ok && ai.ok, status, degraded, chain, arkiv, ai, ...rest, addons })
  })

  if (deps.runtime) registerAgentRoutes(app, deps.runtime)
  if (deps.runtime && deps.disputes) registerDisputeRoutes(app, { ...deps.disputes, runtime: deps.runtime })
  if (deps.market) registerMarketRoutes(app, deps.market)
  if (deps.handover) registerHandoverRoutes(app, deps.handover)
  if (deps.humans) registerHumanRoutes(app, deps.humans)
  if (deps.director) registerDirectorRoutes(app, deps.director)
  if (deps.intel) registerIntelRoute(app, deps.intel)
  if (deps.listing) registerListingRoutes(app, { ...deps.listing, config: deps.config, chain: deps.chain })

  return app
}
