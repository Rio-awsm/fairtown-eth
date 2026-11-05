import { HealthResponse } from "@fairtown/shared/api"
import Fastify, { type FastifyError, type FastifyInstance } from "fastify"
import type { AiGateway } from "./ai/gateway"
import type { ArkivStore } from "./arkiv/ArkivStore"
import type { ChainAdapter } from "./chain/types"
import type { AgentsConfig } from "./config"

export type AppDeps = { config: AgentsConfig; chain: ChainAdapter; arkiv: ArkivStore; ai: Pick<AiGateway, "health">; logger?: boolean }

export const REDACT = ["req.headers.authorization", "*.privateKey", "*.mnemonic", "*.accessKey", "*.apiKey"]

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
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
    const arkiv = { ok: true, detail: deps.arkiv.mode }
    const ai = await deps.ai.health()
    return HealthResponse.parse({ ok: chain.ok && arkiv.ok && ai.ok, chain, arkiv, ai, addons: {} })
  })

  return app
}
