import { HealthResponse } from "@fairtown/shared/api"
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
import { registerListingRoutes, type ListingDeps } from "./listing/routes"
import { registerAgentRoutes } from "./runtime/routes"
import type { AgentRuntime } from "./runtime/runtime"

export type AppDeps = { config: AgentsConfig; chain: ChainAdapter; arkiv: ArkivStore; ai: Pick<AiGateway, "health">; listing?: Omit<ListingDeps, "config" | "chain">; runtime?: AgentRuntime; disputes?: DisputeDeps; market?: MarketDeps; handover?: HandoverDeps; humans?: HumanDeps; director?: Director; logger?: boolean }

export const REDACT = ["req.headers.authorization", "*.privateKey", "*.mnemonic", "*.accessKey", "*.apiKey"]

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    bodyLimit: 12 * 1024 * 1024, // up to 3 phone photos or a voice note as base64
    ...(deps.config.TRUST_PROXY ? { trustProxy: deps.config.TRUST_PROXY } : {}),
    logger: deps.logger === false ? false : { level: "info", redact: { paths: REDACT, censor: "[redacted]" } },
  })

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status === 500) app.log.error(err)
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
    return HealthResponse.parse({ ok: chain.ok && arkiv.ok && ai.ok, chain, arkiv, ai, addons: {} })
  })

  if (deps.runtime) registerAgentRoutes(app, deps.runtime)
  if (deps.runtime && deps.disputes) registerDisputeRoutes(app, { ...deps.disputes, runtime: deps.runtime })
  if (deps.market) registerMarketRoutes(app, deps.market)
  if (deps.handover) registerHandoverRoutes(app, deps.handover)
  if (deps.humans) registerHumanRoutes(app, deps.humans)
  if (deps.director) registerDirectorRoutes(app, deps.director)
  if (deps.listing) registerListingRoutes(app, { ...deps.listing, config: deps.config, chain: deps.chain })

  return app
}
