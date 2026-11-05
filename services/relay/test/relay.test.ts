import { TownSnapshot, type TownEnvelope, type TownEvent } from "@fairtown/shared/protocol"
import { mkdtempSync, writeFileSync } from "node:fs"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { readJsonl, replay } from "../src/replay"
import { buildRelay, type Relay } from "../src/server"
import { RelayState } from "../src/state"

let n = 0
const env = (event: TownEvent, ts = 1000 + n * 2000, block?: number): TownEnvelope => ({
  v: 1,
  id: `t-${++n}`,
  ts,
  ...(block !== undefined ? { block } : {}),
  source: "chain",
  event,
})
const listed = (lotId: string): TownEvent => ({
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
  seller: "0xaa",
  sellerName: "Ingrid",
  auction: "0xbb",
  endBlock: 46,
  parentLotId: "0",
  grade: "fresh_a",
})

describe("RelayState", () => {
  it("dedupes by id", () => {
    const s = new RelayState()
    const e = env(listed("1"))
    expect(s.ingest(e)).toBe(true)
    expect(s.ingest(e)).toBe(false)
    expect(s.snapshot().recent).toHaveLength(1)
  })
  it("folds a lot through its lifecycle and never moves status backwards", () => {
    const s = new RelayState()
    s.ingest(env(listed("1"), 1, 10))
    s.ingest(env({ type: "bid.placed", lotId: "1", agentId: "0x1", maxPerUnit: "9100000", amount: "1", tx: "0x" }))
    s.ingest(env({ type: "price.tick", lotId: "1", clearingPerUnit: "9100000" }))
    s.ingest(
      env({
        type: "lot.settled",
        lotId: "1",
        finalClearingPerUnit: "9100000",
        avgPerUnit: "9100000",
        soldUnits: "600",
        sellerPaid: "1",
        held: "1",
        fee: "1",
        advanceBps: 5000,
        pickupDeadline: 346,
        tx: "0x",
      }),
    )
    s.ingest(env({ type: "lot.paid_in_full", lotId: "1" }))
    s.ingest(env({ type: "handover.confirmed", lotId: "1", buyer: "0x1", receiver: "0x1", releasedToSeller: "1", tx: "0x" }))
    const lot = s.snapshot().lots[0]!
    expect(lot).toMatchObject({ status: "paid_in_full", bids: 1, clearingPerUnit: "9100000", pickupDeadline: 346 })
  })
  it("tracks agents, fx, signals and caps recent at 200", () => {
    const s = new RelayState()
    s.ingest(env({ type: "agent.spawned", agentId: "0x1", name: "Hanse", role: "BUYER", building: "town_gate", sprite: "chef" }))
    s.ingest(env({ type: "agent.intent", agentId: "0x1", action: "move", moveTo: "fish_dock", reason: "Storm coming" }))
    s.ingest(env({ type: "human.joined", agentId: "0x2", name: "Visitor" }))
    s.ingest(env({ type: "fx.updated", currency: "NOK", perUsd: 11 }))
    s.ingest(env({ type: "signal", id: "1", kind: "weather", place: "bergen", severity: 3, label: "Storm", expiresAtBlock: 50 }))
    expect(s.snapshot().signals).toHaveLength(1)
    s.ingest(env({ type: "clock", block: 60 }))
    for (let i = 0; i < 250; i++) s.ingest(env({ type: "clock", block: 60 + i }))
    const snap = TownSnapshot.parse(s.snapshot())
    expect(snap.agents.find((a) => a.agentId === "0x1")!.building).toBe("fish_dock")
    expect(snap.agents.find((a) => a.agentId === "0x2")!.role).toBe("HUMAN")
    expect(snap.fx).toEqual({ NOK: 11 })
    expect(snap.signals).toHaveLength(0)
    expect(snap.recent).toHaveLength(200)
    expect(snap.block).toBe(309)
  })
})

describe("relay server", () => {
  let relay: Relay | undefined
  afterEach(async () => {
    await relay?.app.close()
    relay = undefined
  })
  const make = (opts: { maxBufferedBytes?: number } = {}) => {
    relay = buildRelay({ state: new RelayState(), token: "secret", logger: false, ...opts })
    return relay
  }
  const listen = async (r: Relay) => {
    await r.app.listen({ port: 0, host: "127.0.0.1" })
    return (r.app.server.address() as AddressInfo).port
  }

  it("guards /internal/publish with the bearer token and validates envelopes", async () => {
    const { app } = make()
    const body = [env(listed("1"))]
    expect((await app.inject({ method: "POST", url: "/internal/publish", payload: body })).statusCode).toBe(401)
    const wrong = await app.inject({ method: "POST", url: "/internal/publish", payload: body, headers: { authorization: "Bearer nope!!" } })
    expect(wrong.statusCode).toBe(401)
    const bad = await app.inject({
      method: "POST",
      url: "/internal/publish",
      payload: [{ v: 2 }],
      headers: { authorization: "Bearer secret" },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("bad_request")
    const ok = await app.inject({ method: "POST", url: "/internal/publish", payload: body, headers: { authorization: "Bearer secret" } })
    expect(ok.json()).toEqual({ accepted: 1, duplicates: 0 })
    const again = await app.inject({ method: "POST", url: "/internal/publish", payload: body, headers: { authorization: "Bearer secret" } })
    expect(again.json()).toEqual({ accepted: 0, duplicates: 1 })
    const snap = (await app.inject({ method: "GET", url: "/snapshot" })).json()
    expect(snap.lots).toHaveLength(1)
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toMatchObject({ ok: true, clients: 0 })
  })

  it("broadcasts to WebSocket clients once per envelope", async () => {
    const r = make()
    const port = await listen(r)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await once(ws, "open")
    const got: TownEnvelope[] = []
    ws.on("message", (d) => got.push(JSON.parse(String(d))))
    const e = env(listed("7"))
    r.publish([e, e])
    await new Promise((res) => setTimeout(res, 50))
    expect(got.map((g) => g.id)).toEqual([e.id])
    ws.close()
  })

  it("refuses upgrades on other paths", async () => {
    const r = make()
    const port = await listen(r)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other`)
    const [err] = await once(ws, "error")
    expect(err).toBeInstanceOf(Error)
  })

  it("drops a client whose buffer is over the limit", async () => {
    const r = make({ maxBufferedBytes: -1 })
    const port = await listen(r)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await once(ws, "open")
    expect(r.clients()).toBe(1)
    r.publish([env(listed("8"))])
    await once(ws, "close")
    expect(r.clients()).toBe(0)
  })
})

describe("replay", () => {
  it("keeps order and scales gaps by speed", async () => {
    const envs = [env(listed("1"), 0), env(listed("2"), 2000), env(listed("3"), 6000)]
    const delays: number[] = []
    const out: string[] = []
    await replay(envs, (e) => out.push(e.id), { speed: 10, sleep: async (ms) => void delays.push(ms) })
    expect(out).toEqual(envs.map((e) => e.id))
    expect(delays).toEqual([200, 400])
  })
  it("dedupes a second replay through the relay", async () => {
    const r = buildRelay({ state: new RelayState(), token: "t", logger: false })
    const envs = [env(listed("1")), env(listed("2"))]
    const totals = { accepted: 0, duplicates: 0 }
    const sink = (e: TownEnvelope) => {
      const res = r.publish([e])
      totals.accepted += res.accepted
      totals.duplicates += res.duplicates
    }
    const noSleep = async () => {}
    await replay(envs, sink, { speed: 1, sleep: noSleep })
    await replay(envs, sink, { speed: 1, sleep: noSleep })
    expect(totals).toEqual({ accepted: 2, duplicates: 2 })
    await r.app.close()
  })
  it("reads JSONL and names the bad line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-"))
    const good = join(dir, "good.jsonl")
    writeFileSync(good, `${JSON.stringify(env(listed("1")))}\n\n${JSON.stringify(env(listed("2")))}\n`)
    expect(await readJsonl(good)).toHaveLength(2)
    const bad = join(dir, "bad.jsonl")
    writeFileSync(bad, `${JSON.stringify(env(listed("1")))}\n{"v":1}\n`)
    await expect(readJsonl(bad)).rejects.toThrow("bad.jsonl line 2")
    await expect(replay([], () => {}, { speed: 0 })).rejects.toThrow("speed")
  })
})
