import { TownEnvelope, TownSnapshot } from "@fairtown/shared/protocol"
import type { Log } from "./log"

// TG 2.1: the relay's town stream (:8788/ws) is the bot's only source of market events. Every message is zod-checked,
// duplicates are dropped by envelope id, and after a reconnect the snapshot reseeds state (missed events are not
// replayed, so no notification is sent for them).
export type Feed = { start(): void; stop(): void; snapshot(): Promise<TownSnapshot> }
export type FeedHandlers = { onSnapshot: (s: TownSnapshot) => void; onEvent: (e: TownEnvelope) => void | Promise<void> }

type Socket = Pick<WebSocket, "close"> & {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type FeedOptions = {
  url: string // ws(s)://host:8788/ws
  log: Log
  fetch?: typeof fetch
  connect?: (url: string) => Socket
  backoffMs?: (attempt: number) => number
  setTimer?: (f: () => void, ms: number) => unknown
}

export const snapshotUrl = (ws: string) => `${ws.replace(/^ws/, "http").replace(/\/ws\/?$/, "").replace(/\/+$/, "")}/snapshot`

export class Dedupe {
  private readonly seen = new Set<string>()
  constructor(private readonly max = 5000) {}
  first(id: string): boolean {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    if (this.seen.size > this.max) this.seen.delete(this.seen.values().next().value!)
    return true
  }
}

export function relayFeed(o: FeedOptions, h: FeedHandlers): Feed {
  const f = o.fetch ?? fetch
  const connect = o.connect ?? ((url: string) => new WebSocket(url) as unknown as Socket)
  const backoff = o.backoffMs ?? ((n: number) => Math.min(30_000, 1000 * 2 ** Math.min(n, 5)))
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref())
  const dedupe = new Dedupe()
  let ws: Socket | undefined
  let attempt = 0
  let stopped = false

  const snapshot = async () => {
    const res = await f(snapshotUrl(o.url), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`relay snapshot HTTP ${res.status}`)
    return TownSnapshot.parse(await res.json())
  }

  const open = () => {
    if (stopped) return
    ws = connect(o.url)
    ws.onopen = () => {
      attempt = 0
      o.log.info("relay connected")
      snapshot().then(
        (s) => {
          for (const env of s.recent) dedupe.first(env.id) // already happened: never notify for these
          h.onSnapshot(s)
        },
        (e: unknown) => o.log.warn("relay snapshot failed", { detail: e instanceof Error ? e.message : String(e) }),
      )
    }
    ws.onmessage = (ev) => {
      let raw: unknown
      try {
        raw = JSON.parse(String(ev.data))
      } catch {
        return o.log.warn("relay sent non-JSON")
      }
      const env = TownEnvelope.safeParse(raw)
      if (!env.success) return o.log.warn("relay sent an unknown envelope")
      if (!dedupe.first(env.data.id)) return
      // Inside .then so even a synchronous throw is caught: an uncaught error in a socket callback ends the process.
      Promise.resolve()
        .then(() => h.onEvent(env.data))
        .catch((e: unknown) => o.log.error("relay event handler failed", { type: env.data.event.type, detail: e instanceof Error ? e.message : String(e) }))
    }
    ws.onerror = () => undefined // onclose follows and reconnects
    ws.onclose = () => {
      ws = undefined
      if (stopped) return
      const ms = backoff(attempt++)
      o.log.warn("relay disconnected", { retryInMs: ms })
      setTimer(open, ms)
    }
  }

  return {
    start: open,
    stop: () => {
      stopped = true
      ws?.close()
    },
    snapshot,
  }
}
