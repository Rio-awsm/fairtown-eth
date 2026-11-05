import { TownEnvelope, TownSnapshot } from "@fairtown/shared/protocol"
import { Deduper } from "./dedupe"

export type RelayStatus = "connecting" | "live" | "reconnecting" | "replay" | "replay_done"

export type RelayHandlers = {
  onSnapshot(snapshot: TownSnapshot): void
  onEnvelope(envelope: TownEnvelope): void
  onStatus(status: RelayStatus): void
  onReject(reason: string): void
}

export type RelayClient = { start(): void; stop(): void }

export type RelayClientOptions = {
  wsUrl: string
  snapshotUrl: string
  handlers: RelayHandlers
  fetchImpl?: typeof fetch
  WebSocketImpl?: typeof WebSocket
  backoff?: { baseMs: number; maxMs: number }
  dedupe?: Deduper
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Live relay (contract 12.3): open the socket and buffer, load the snapshot, then drain the buffer
 * through dedupe. Nothing between the snapshot and the socket is lost. Reconnects with backoff and
 * refetches the snapshot each time.
 */
export function createRelayClient(opts: RelayClientOptions): RelayClient {
  const { wsUrl, snapshotUrl, handlers } = opts
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const WebSocketImpl = opts.WebSocketImpl ?? globalThis.WebSocket
  const { baseMs, maxMs } = opts.backoff ?? { baseMs: 500, maxMs: 10_000 }
  const dedupe = opts.dedupe ?? new Deduper()

  let started = false
  let stopped = false
  let socket: WebSocket | null = null
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const reject = (reason: string) => {
    console.warn(`relay frame rejected: ${reason}`)
    handlers.onReject(reason)
  }

  const handleFrame = (data: unknown) => {
    if (typeof data !== "string") return reject("frame is not text")
    let json: unknown
    try {
      json = JSON.parse(data)
    } catch (error: unknown) {
      return reject(`not JSON: ${describe(error)}`)
    }
    const parsed = TownEnvelope.safeParse(json)
    if (!parsed.success) return reject(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
    if (dedupe.seen(parsed.data.id)) return
    handlers.onEnvelope(parsed.data)
  }

  const scheduleReconnect = () => {
    handlers.onStatus("reconnecting")
    const delay = Math.min(maxMs, baseMs * 2 ** attempt)
    attempt++
    timer = setTimeout(connect, delay)
  }

  async function loadSnapshot(ws: WebSocket, buffer: unknown[], markReady: () => void) {
    try {
      const res = await fetchImpl(snapshotUrl)
      if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`)
      const parsed = TownSnapshot.safeParse(await res.json())
      if (!parsed.success) throw new Error(`snapshot schema: ${parsed.error.issues[0]?.message ?? "invalid"}`)
      if (socket !== ws) return
      handlers.onSnapshot(parsed.data)
      for (const e of parsed.data.recent) dedupe.seen(e.id)
      markReady()
      for (const frame of buffer.splice(0)) handleFrame(frame)
      attempt = 0
      handlers.onStatus("live")
    } catch (error: unknown) {
      console.warn(`relay snapshot failed: ${describe(error)}`)
      if (socket === ws) ws.close()
    }
  }

  function connect() {
    if (stopped) return
    const ws = new WebSocketImpl(wsUrl)
    socket = ws
    let ready = false
    const buffer: unknown[] = []
    ws.onmessage = (e: MessageEvent) => (ready ? handleFrame(e.data) : buffer.push(e.data))
    ws.onopen = () => void loadSnapshot(ws, buffer, () => (ready = true))
    ws.onerror = () => console.warn("relay socket error")
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      if (!stopped) scheduleReconnect()
    }
  }

  return {
    start() {
      if (started) return
      started = true
      handlers.onStatus("connecting")
      connect()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      const ws = socket
      socket = null
      ws?.close()
    },
  }
}
