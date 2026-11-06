import { TownEnvelope } from "@fairtown/shared/protocol"
import Fastify, { type FastifyError, type FastifyInstance } from "fastify"
import { timingSafeEqual } from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"
import { z } from "zod"
import type { ChainMapper, RawChainEvent } from "./mapping"
import type { RelayState } from "./state"

export type RelayDeps = {
  state: RelayState
  token: string
  logger?: boolean
  maxBufferedBytes?: number
  heartbeatMs?: number
  // Dev bridge for CHAIN_MODE=fake: the agents service forwards FakeChain logs and the relay maps them, so the relay stays
  // the only producer of chain-derived events.
  mapper?: ChainMapper
}
export type Relay = {
  app: FastifyInstance
  publish: (envs: TownEnvelope[]) => { accepted: number; duplicates: number }
  clients: () => number
}

const Batch = z.array(TownEnvelope)

export function buildRelay(deps: RelayDeps): Relay {
  const app = Fastify({
    logger: deps.logger === false ? false : { level: "info", redact: ["req.headers.authorization"] },
  })
  const wss = new WebSocketServer({ noServer: true })
  const alive = new WeakMap<WebSocket, boolean>()
  const maxBuffered = deps.maxBufferedBytes ?? 1_000_000

  app.server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://relay")
    if (pathname !== "/ws") {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
  })
  wss.on("connection", (ws) => {
    alive.set(ws, true)
    ws.on("pong", () => alive.set(ws, true))
    ws.on("error", () => ws.terminate())
  })
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate()
        continue
      }
      alive.set(ws, false)
      ws.ping()
    }
  }, deps.heartbeatMs ?? 30_000)
  beat.unref()

  const broadcast = (env: TownEnvelope) => {
    const msg = JSON.stringify(env)
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      if (ws.bufferedAmount > maxBuffered) {
        ws.terminate()
        continue
      }
      ws.send(msg)
    }
  }
  const publish = (envs: TownEnvelope[]) => {
    let accepted = 0
    for (const env of envs) {
      if (!deps.state.ingest(env)) continue
      accepted++
      broadcast(env)
    }
    return { accepted, duplicates: envs.length - accepted }
  }

  const expected = Buffer.from(deps.token)
  const authorized = (header: string | undefined) => {
    if (!header?.startsWith("Bearer ")) return false
    const got = Buffer.from(header.slice(7))
    return got.length === expected.length && timingSafeEqual(got, expected)
  }

  app.addHook("preClose", async () => {
    clearInterval(beat)
    for (const ws of wss.clients) ws.terminate()
    wss.close()
  })
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    reply.status(status).send({ error: { code: err.code ?? "internal", message: status === 500 ? "Internal error" : err.message } })
  })
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: "not_found", message: `${req.method} ${req.url} not found` } })
  })

  app.post("/internal/chain", async (req, reply) => {
    if (!authorized(req.headers.authorization))
      return reply.status(401).send({ error: { code: "unauthorized", message: "Bad or missing bearer token" } })
    if (!deps.mapper) return reply.status(409).send({ error: { code: "not_fake", message: "Chain bridge is only for CHAIN_MODE=fake" } })
    const body = req.body as RawChainEvent[]
    if (!Array.isArray(body)) return reply.status(400).send({ error: { code: "bad_request", message: "body must be an array of chain events" } })
    let accepted = 0
    for (const e of body) {
      const envs = await deps.mapper.map(e)
      if (e.eventName === "LotSettled") deps.mapper.forget(BigInt(String(e.args.lotId)))
      accepted += publish(envs).accepted
    }
    return { accepted }
  })

  app.get("/health", async () => ({ ok: true, clients: wss.clients.size, block: deps.state.currentBlock }))
  app.get("/snapshot", async () => deps.state.snapshot())
  app.post("/internal/publish", async (req, reply) => {
    if (!authorized(req.headers.authorization))
      return reply.status(401).send({ error: { code: "unauthorized", message: "Bad or missing bearer token" } })
    const parsed = Batch.safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!
      return reply.status(400).send({ error: { code: "bad_request", message: `${issue.path.join(".")}: ${issue.message}` } })
    }
    return publish(parsed.data)
  })

  return { app, publish, clients: () => wss.clients.size }
}
