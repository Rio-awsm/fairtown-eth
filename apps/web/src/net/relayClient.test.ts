import type { TownEnvelope, TownSnapshot } from "@fairtown/shared/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SAMPLE_EVENTS, emptySnapshot, envelope } from "../test/samples"
import { Deduper } from "./dedupe"
import { createRelayClient, type RelayHandlers, type RelayStatus } from "./relayClient"

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
  open() {
    this.onopen?.()
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) })
  }
  drop() {
    this.close()
  }
}

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const flush = () => vi.advanceTimersByTimeAsync(0)

function setup(snapshots: Array<TownSnapshot | Error | Promise<Response>>) {
  const log: string[] = []
  const statuses: RelayStatus[] = []
  const delivered: TownEnvelope[] = []
  const rejects: string[] = []
  const handlers: RelayHandlers = {
    onSnapshot: (s) => log.push(`snapshot:${s.block}`),
    onEnvelope: (e) => {
      log.push(`env:${e.id}`)
      delivered.push(e)
    },
    onStatus: (s) => statuses.push(s),
    onReject: (r) => rejects.push(r),
  }
  const fetchImpl = vi.fn(async () => {
    const next = snapshots.shift()
    if (next instanceof Error) throw next
    if (next instanceof Promise) return next
    return response(next ?? emptySnapshot())
  })
  const client = createRelayClient({
    wsUrl: "ws://relay.test/ws",
    snapshotUrl: "http://relay.test/snapshot",
    handlers,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  })
  return { client, log, statuses, delivered, rejects, fetchImpl, sockets: FakeWebSocket.instances }
}

const A = envelope(SAMPLE_EVENTS["lot.listed"], "a")
const B = envelope(SAMPLE_EVENTS["price.tick"], "b")
const C = envelope(SAMPLE_EVENTS["bid.placed"], "c")

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("createRelayClient", () => {
  it("buffers frames that arrive before the snapshot, then delivers them in order", async () => {
    const snap = deferred<Response>()
    const t = setup([snap.promise])
    t.client.start()
    t.sockets[0]!.open()
    t.sockets[0]!.receive(A)
    t.sockets[0]!.receive(B)
    expect(t.log).toEqual([])
    snap.resolve(response({ ...emptySnapshot(), block: 1050 }))
    await flush()
    expect(t.log).toEqual(["snapshot:1050", "env:a", "env:b"])
    expect(t.statuses.at(-1)).toBe("live")
  })

  it("skips envelopes the snapshot already carried in recent", async () => {
    const t = setup([{ ...emptySnapshot(), recent: [A] }])
    t.client.start()
    t.sockets[0]!.open()
    t.sockets[0]!.receive(A)
    t.sockets[0]!.receive(B)
    await flush()
    expect(t.delivered.map((e) => e.id)).toEqual(["b"])
  })

  it("delivers a duplicate id from the socket once", async () => {
    const t = setup([emptySnapshot()])
    t.client.start()
    t.sockets[0]!.open()
    await flush()
    t.sockets[0]!.receive(A)
    t.sockets[0]!.receive(A)
    expect(t.delivered.map((e) => e.id)).toEqual(["a"])
  })

  it("reconnects with backoff, refetches the snapshot and never redelivers", async () => {
    const t = setup([emptySnapshot(), new Error("relay down"), emptySnapshot()])
    t.client.start()
    t.sockets[0]!.open()
    await flush()
    t.sockets[0]!.receive(A)
    t.sockets[0]!.drop()
    expect(t.statuses.at(-1)).toBe("reconnecting")

    await vi.advanceTimersByTimeAsync(499)
    expect(t.sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.sockets).toHaveLength(2)
    t.sockets[1]!.open()
    await flush() // snapshot fetch fails, so the client backs off again, now 1000 ms
    expect(t.statuses.at(-1)).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(999)
    expect(t.sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.sockets).toHaveLength(3)

    t.sockets[2]!.open()
    t.sockets[2]!.receive(A)
    t.sockets[2]!.receive(C)
    await flush()
    expect(t.fetchImpl).toHaveBeenCalledTimes(3)
    expect(t.delivered.map((e) => e.id)).toEqual(["a", "c"])
    expect(t.statuses.at(-1)).toBe("live")
  })

  it("resets the backoff after a successful reconnect", async () => {
    const t = setup([emptySnapshot(), emptySnapshot(), emptySnapshot()])
    t.client.start()
    t.sockets[0]!.open()
    await flush()
    t.sockets[0]!.drop()
    await vi.advanceTimersByTimeAsync(500)
    t.sockets[1]!.open()
    await flush()
    t.sockets[1]!.drop()
    await vi.advanceTimersByTimeAsync(500)
    expect(t.sockets).toHaveLength(3)
  })

  it("rejects a frame that is not JSON and one from protocol v2, and keeps the stream going", async () => {
    const t = setup([emptySnapshot()])
    t.client.start()
    t.sockets[0]!.open()
    await flush()
    t.sockets[0]!.receive("not json")
    t.sockets[0]!.receive({ ...B, v: 2 })
    t.sockets[0]!.receive(C)
    expect(t.rejects).toHaveLength(2)
    expect(t.delivered.map((e) => e.id)).toEqual(["c"])
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it("rejects a snapshot that breaks the schema and retries", async () => {
    const t = setup([{ block: "nope" } as unknown as TownSnapshot, emptySnapshot()])
    t.client.start()
    t.sockets[0]!.open()
    await flush()
    expect(t.statuses.at(-1)).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(500)
    t.sockets[1]!.open()
    await flush()
    expect(t.statuses.at(-1)).toBe("live")
  })

  it("opens one socket even when start is called twice (React StrictMode)", () => {
    const t = setup([emptySnapshot()])
    t.client.start()
    t.client.start()
    expect(t.sockets).toHaveLength(1)
  })

  it("stops reconnecting after stop", async () => {
    const t = setup([emptySnapshot()])
    t.client.start()
    t.sockets[0]!.open()
    await flush()
    t.client.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(t.sockets).toHaveLength(1)
    expect(t.sockets[0]!.closed).toBe(true)
  })
})

describe("Deduper", () => {
  it("forgets the oldest id once full", () => {
    const d = new Deduper(2)
    expect(d.seen("a")).toBe(false)
    expect(d.seen("b")).toBe(false)
    expect(d.seen("a")).toBe(true)
    expect(d.seen("c")).toBe(false)
    expect(d.seen("a")).toBe(false)
  })
})
