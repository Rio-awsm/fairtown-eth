import type { TownEnvelope, TownEvent } from "@fairtown/shared/protocol"
import { GrammyError } from "grammy"
import { describe, expect, it } from "vitest"
import { Links } from "../src/links"
import type { Log } from "../src/log"
import { Market } from "../src/market"
import { Notifier, sendQueue, THROTTLE_MS } from "../src/notify"
import { Dedupe, relayFeed, snapshotUrl } from "../src/relay"
import { INGRID, LARS, WALKIN_1 } from "./harness"

const SELLER = 1001
const BUYER = 2002
const DRIVER = 3003
const quiet: Log = { info: () => undefined, warn: () => undefined, error: () => undefined }
let n = 0
const env = (event: TownEvent, block = 50): TownEnvelope => ({ v: 1, id: `e${++n}`, ts: 1, block, source: "chain", event })
const listed = (lotId: string, seller = INGRID): TownEvent => ({
  type: "lot.listed",
  lotId,
  building: "fish_dock",
  sector: "fish",
  commodity: "cod",
  qty: 600,
  unit: "kg",
  currency: "EUR",
  place: "bergen",
  floorPerUnit: "7500000",
  seller,
  sellerName: "Ingrid Solheim",
  auction: `0x${"a".repeat(40)}`,
  endBlock: 100,
  parentLotId: "0",
  grade: "class_1",
})

function setup() {
  let clock = 1_000_000
  const links = new Links(() => clock)
  links.set(SELLER, { role: "SELLER", sellerId: "ingrid", name: "Ingrid Solheim", address: INGRID })
  links.set(BUYER, { role: "HUMAN", agentId: WALKIN_1, name: "Bo", currency: "EUR" })
  links.set(DRIVER, { role: "TRUCK", sellerId: "lars", name: "Lars", address: LARS })
  const market = new Market()
  market.apply(env(listed("12")))
  const out: Array<[number, string]> = []
  const notifier = new Notifier({ links, market, now: () => clock, send: async (u, t) => void out.push([u, t]) })
  const emit = async (e: TownEvent) => {
    const x = env(e)
    market.apply(x)
    await notifier.handle(x)
  }
  return { links, market, out, emit, to: (u: number) => out.filter(([x]) => x === u).map(([, t]) => t), tick: (ms: number) => (clock += ms) }
}

describe("notifications", () => {
  it("tells the seller about bids, at most once a minute per lot, counting the rest", async () => {
    const s = setup()
    const bid = (max: string): TownEvent => ({ type: "bid.placed", lotId: "12", agentId: `0x${"e".repeat(40)}`, maxPerUnit: max, amount: "1", tx: "0x1" })
    await s.emit(bid("8000000"))
    await s.emit(bid("8100000"))
    await s.emit(bid("8200000"))
    s.tick(THROTTLE_MS)
    await s.emit(bid("8400000"))
    expect(s.to(SELLER)).toEqual(["New bid on your lot #12: up to 8 EUR per kg.", "New bid on your lot #12: up to 8.4 EUR per kg. (2 more since the last update.)"])
  })

  it("stays quiet about a bot user's own bid", async () => {
    const s = setup()
    await s.emit({ type: "bid.placed", lotId: "12", agentId: WALKIN_1, maxPerUnit: "8000000", amount: "1", tx: "0x1" })
    expect(s.out).toEqual([])
  })

  it("warns a bot buyer once when the price passes their max, and again after a new bid", async () => {
    const s = setup()
    s.market.recordBid("12", BUYER, 8_400_000n)
    await s.emit({ type: "price.tick", lotId: "12", clearingPerUnit: "8400000" })
    await s.emit({ type: "price.tick", lotId: "12", clearingPerUnit: "8500000" })
    await s.emit({ type: "price.tick", lotId: "12", clearingPerUnit: "8600000" })
    expect(s.to(BUYER)).toEqual(["You're outbid on lot #12: the price is now 8.5 EUR per kg, above your max of 8.4 EUR. Send /bid 12 to bid again."])
    s.market.recordBid("12", BUYER, 8_700_000n)
    await s.emit({ type: "price.tick", lotId: "12", clearingPerUnit: "8800000" })
    expect(s.to(BUYER)).toHaveLength(2)
  })

  it("reports a sale with exact money to the seller, and tells bidders how to collect", async () => {
    const s = setup()
    s.market.recordBid("12", BUYER, 9_000_000n)
    await s.emit({ type: "lot.settled", lotId: "12", finalClearingPerUnit: "8400000", avgPerUnit: "8400000", soldUnits: "600", sellerPaid: "2494800000", held: "2494800000", fee: "50400000", advanceBps: 5000, pickupDeadline: 346, tx: "0x1" })
    expect(s.to(SELLER)[0]).toBe(
      "Lot #12 sold 600 units at 8.4 EUR per kg. Paid to you now: 2,494.8 EUR. Held until pickup: 2,494.8 EUR (fee 50.4 EUR). Pickup deadline: block 346. Hand over with /qr 12.",
    )
    expect(s.to(BUYER)[0]).toMatch(/closed at 8.4 EUR per kg. If you won some, collect it from the seller before block 346: .*\/receive <code>/)
    expect(s.market.lots.get("12")!.status).toBe("sold")
  })

  it("says plainly when nothing sold", async () => {
    const s = setup()
    await s.emit({ type: "lot.settled", lotId: "12", finalClearingPerUnit: "0", avgPerUnit: "0", soldUnits: "0", sellerPaid: "0", held: "0", fee: "0", advanceBps: 5000, pickupDeadline: 0, tx: "0x1" })
    expect(s.to(SELLER)).toEqual(["Lot #12 closed without a sale. Nothing was paid or held."])
  })

  it("covers the rest of a lot's life: relist, truck, handover, delivery, paid in full", async () => {
    const s = setup()
    await s.emit({ type: "lot.relisted", lotId: "12", newLotId: "14", newFloorPerUnit: "6375000" })
    await s.emit({ type: "carrier.assigned", lotId: "12", truckLotId: "20", carrier: LARS })
    await s.emit({ type: "handover.confirmed", lotId: "12", buyer: WALKIN_1, receiver: LARS, releasedToSeller: "2494800000", tx: "0x1" })
    await s.emit({ type: "lot.delivered", lotId: "12", truckLotId: "20" })
    await s.emit({ type: "lot.paid_in_full", lotId: "12" })
    expect(s.to(SELLER)).toEqual([
      "Lot #12 didn't fully sell, so the rest is relisted as lot #14 at a floor of 6.375 EUR per kg.",
      "A truck is booked for lot #12. Show the driver your handover code at pickup: /qr 12.",
      "Handover done for lot #12: 2,494.8 EUR released to you.",
      "Lot #12 was delivered to the buyer.",
      "Lot #12 is paid in full.",
    ])
    expect(s.to(DRIVER)).toEqual([
      "You're booked to carry lot #12 (your truck lot #20). At pickup, get the seller's handover code and send /receive <code>. At drop-off, show the buyer /qr 20.",
      "Handover for lot #12 confirmed.",
    ])
    expect(s.to(BUYER)).toEqual(["Your goods from lot #12 were picked up by the carrier."])
  })

  it("asks drivers to offer space when transport is needed, throttled", async () => {
    const s = setup()
    const need: TownEvent = { type: "transport.needed", lotId: "12", fromBuilding: "fish_dock", place: "bergen", qty: "600" }
    await s.emit(need)
    await s.emit(need)
    expect(s.to(DRIVER)).toEqual(["Transport needed: lot #12, 600 units from Fish Dock (Bergen). To offer space, /sell your truck capacity."])
    expect(s.to(SELLER)).toEqual([])
  })

  it("walks a no-show through: report, refund, record", async () => {
    const s = setup()
    await s.emit({ type: "noshow.reported", lotId: "12", buyer: WALKIN_1, contestEnds: 900 })
    expect(s.market.reporterOf("12")).toBe(WALKIN_1.toLowerCase())
    await s.emit({ type: "noshow.contested", lotId: "12", buyer: WALKIN_1, disputeId: "3" })
    await s.emit({ type: "noshow.refunded", lotId: "12", seller: INGRID, buyer: WALKIN_1, refund: "2494800000" })
    await s.emit({ type: "seller.record", seller: INGRID, cleanLots: 2, noShows: 1, proven: false })
    expect(s.to(SELLER)).toEqual([
      "A buyer reports you didn't hand over lot #12. If you did, contest it with photos before block 900: /contest 12. Otherwise their share of the held money is refunded.",
      "Lot #12: the buyer was refunded 2,494.8 EUR of the held money, and your record shows a no-show.",
      "Your record: 2 clean lots, 1 no-show, new seller.",
    ])
    expect(s.to(BUYER)).toEqual(["The seller contested your no-show report on lot #12. A ruling follows.", "Refund on lot #12: 2,494.8 EUR back to you."])
  })

  it("tells the seller about disputes and rulings", async () => {
    const s = setup()
    await s.emit({ type: "dispute.opened", disputeId: "4", lotId: "12", buyer: WALKIN_1, kind: "quality" })
    await s.emit({ type: "dispute.resolved", disputeId: "4", lotId: "12", refundBps: 2500 })
    expect(s.to(SELLER)).toEqual(["A buyer disputed lot #12 (quality). A ruling follows.", "Ruling on lot #12: 25% of the disputed held share goes back to the buyer."])
  })

  it("sends nothing for lots and people it doesn't know", async () => {
    const s = setup()
    await s.emit({ type: "lot.paid_in_full", lotId: "999" })
    await s.emit({ type: "handover.confirmed", lotId: "999", buyer: `0x${"9".repeat(40)}`, receiver: `0x${"9".repeat(40)}`, releasedToSeller: "1", tx: "0x1" })
    await s.emit({ type: "clock", block: 60 })
    expect(s.out).toEqual([])
    expect(s.market.block).toBe(60)
  })
})

describe("send queue", () => {
  it("keeps order, waits out a 429 once, and forgets users who blocked the bot", async () => {
    const links = new Links()
    links.set(5, { role: "HUMAN", agentId: WALKIN_1, name: "x", currency: "USD" })
    const sent: Array<[number, string]> = []
    const slept: number[] = []
    let limited = true
    const send = sendQueue({
      links,
      log: quiet,
      sleep: async (ms) => void slept.push(ms),
      sendMessage: async (chat, text) => {
        if (chat === 4 && limited) {
          limited = false
          throw new GrammyError("x", { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } }, "sendMessage", {})
        }
        if (chat === 5) throw new GrammyError("x", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendMessage", {})
        sent.push([chat, text])
      },
    })
    await Promise.all([send(4, "a"), send(5, "b"), send(6, "c")])
    expect(sent).toEqual([
      [4, "a"],
      [6, "c"],
    ])
    expect(slept).toContain(3000)
    expect(links.get(5)).toBeUndefined()
  })
})

describe("relay feed", () => {
  type FakeSocket = { onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null; close: () => void }
  function feed(snapshot: object = { block: 5, lots: [], agents: [], signals: [], fx: {}, recent: [] }) {
    const sockets: FakeSocket[] = []
    const timers: Array<() => void> = []
    const events: TownEnvelope[] = []
    const snaps: number[] = []
    const warns: string[] = []
    const log: Log = { info: () => undefined, warn: (m) => void warns.push(m), error: (m) => void warns.push(m) }
    let fetched = ""
    const f = relayFeed(
      {
        url: "ws://relay.test:8788/ws",
        log,
        fetch: async (u) => {
          fetched = String(u)
          return new Response(JSON.stringify(snapshot))
        },
        connect: () => {
          const s: FakeSocket = { onopen: null, onmessage: null, onclose: null, onerror: null, close: () => s.onclose?.({}) }
          sockets.push(s)
          return s
        },
        backoffMs: (k) => 100 * (k + 1),
        setTimer: (fn) => void timers.push(fn),
      },
      {
        onSnapshot: (s) => void snaps.push(s.block),
        onEvent: (e) => {
          if (e.id === "boom") throw new Error("handler bug")
          events.push(e)
        },
      },
    )
    return { f, sockets, timers, events, snaps, warns, fetched: () => fetched }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const tickEnv = (id: string) => JSON.stringify({ v: 1, id, ts: 1, source: "chain", event: { type: "price.tick", lotId: "12", clearingPerUnit: "8400000" } })

  it("reads the snapshot on connect and passes on each new, valid event once", async () => {
    const t = feed({ block: 5, lots: [], agents: [], signals: [], fx: {}, recent: [JSON.parse(tickEnv("old"))] })
    t.f.start()
    t.sockets[0]!.onopen!({})
    await flush()
    expect(t.fetched()).toBe("http://relay.test:8788/snapshot")
    expect(t.snaps).toEqual([5])
    for (const data of [tickEnv("old"), tickEnv("e1"), tickEnv("e1"), "not json", JSON.stringify({ v: 1, id: "x", event: { type: "nope" } })]) t.sockets[0]!.onmessage!({ data })
    await flush()
    expect(t.events.map((e) => e.id)).toEqual(["e1"])
    expect(t.warns).toEqual(["relay sent non-JSON", "relay sent an unknown envelope"])
  })

  it("reconnects with backoff after a drop, and not after stop", async () => {
    const t = feed()
    t.f.start()
    t.sockets[0]!.onclose!({})
    expect(t.timers).toHaveLength(1)
    t.timers[0]!()
    expect(t.sockets).toHaveLength(2)
    t.f.stop()
    expect(t.timers).toHaveLength(1)
  })

  it("survives a handler bug and a failed snapshot", async () => {
    const t = feed()
    t.f.start()
    t.sockets[0]!.onmessage!({ data: tickEnv("boom") })
    await flush()
    expect(t.warns).toContain("relay event handler failed")
    const bad = relayFeed({ url: "ws://x/ws", log: quiet, fetch: async () => new Response("no", { status: 503 }), connect: () => t.sockets[0]!, setTimer: () => undefined }, { onSnapshot: () => undefined, onEvent: () => undefined })
    await expect(bad.snapshot()).rejects.toThrow(/503/)
  })

  it("builds the snapshot URL from the socket URL and bounds its dedupe memory", () => {
    expect(snapshotUrl("wss://relay.example/ws")).toBe("https://relay.example/snapshot")
    expect(snapshotUrl("ws://localhost:8788/ws/")).toBe("http://localhost:8788/snapshot")
    const d = new Dedupe(2)
    expect([d.first("a"), d.first("b"), d.first("a"), d.first("c"), d.first("a")]).toEqual([true, true, false, true, true])
  })
})
