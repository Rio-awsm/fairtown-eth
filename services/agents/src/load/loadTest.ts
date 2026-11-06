import { toBase, type Commodity, type Currency, type TownEnvelope } from "@fairtown/shared"
import type { AddressInfo } from "node:net"
import { english, generateMnemonic } from "viem/accounts"
import { ChainMapper } from "../../../relay/src/mapping"
import { buildRelay } from "../../../relay/src/server"
import { RelayState } from "../../../relay/src/state"
import { ChainError } from "../chain/errors"
import { FakeChain } from "../chain/fake/FakeChain"
import type { ChainAdapter, ChainEvent, LotSpecInput } from "../chain/types"
import { parseConfig, protocolParams } from "../config"
import { PERSONAS } from "../fixtures/personas"
import { loadReferences } from "../listing/references"
import { ChainBridge, RelayPublisher } from "../runtime/publisher"
import { AgentRuntime } from "../runtime/runtime"
import { Wallets } from "../runtime/wallets"
import { SectorEngine } from "../sectors/engine"
import { AUCTION_BLOCKS, PICKUP_BLOCKS, type SectorRules } from "../sectors/rules"
import { ruleStrategy } from "../strategies/rule"

// Guide 2 step 6.2 thresholds.
export const LOAD_THRESHOLDS = { txSuccess: 0.99, nonceErrors: 0, relayP95Ms: 1000 }

type LotKind = { seller: string; spec: Omit<LotSpecInput, "durationBlocks" | "pickupWindowBlocks" | "seller" | "metadataURI" | "parentLotId"> }
export const LOAD_LOTS: LotKind[] = [
  { seller: "ingrid", spec: { sector: "fish", market: "fish_dock", commodity: "cod", grade: "fresh_a", place: "bergen", currency: "EUR", qty: 600n, floorPerUnit: toBase("7.50") } },
  { seller: "coastal_catch", spec: { sector: "fish", market: "fish_dock", commodity: "haddock", grade: "fresh_a", place: "bergen", currency: "EUR", qty: 400n, floorPerUnit: toBase("6.00") } },
  { seller: "amina", spec: { sector: "produce", market: "harvest_hall", commodity: "tomato", grade: "class_1", place: "lagos", currency: "USD", qty: 3000n, floorPerUnit: toBase("0.40") } },
  { seller: "ganesh", spec: { sector: "flowers", market: "flower_hall", commodity: "marigold", grade: "class_1", place: "pune", currency: "USD", qty: 2000n, floorPerUnit: toBase("0.90") } },
  { seller: "wanjiru", spec: { sector: "flowers", market: "flower_hall", commodity: "rose", grade: "bloom_a", place: "nairobi", currency: "EUR", qty: 1000n, floorPerUnit: toBase("4.00") } },
  { seller: "northlight", spec: { sector: "compute", market: "compute_yard", commodity: "gpu_hour", grade: "gpu_verified", place: "any_dc", currency: "USD", qty: 200n, floorPerUnit: toBase("1.80") } },
]

const WRITES = new Set(["register", "mint", "sendEth", "ensurePermit2", "createLot", "submitBid", "relist", "confirmHandover", "reportNoShow", "contestNoShow", "openDispute", "requestStorage"])
const lc = (a: string) => a.toLowerCase()

export type LoadReport = {
  chain: string
  agents: number
  openLots: number
  minutes: number
  blocks: string
  lotsListed: number
  lotsSettled: number
  bids: number
  writes: { attempted: number; ok: number; failed: number; simulatedRejects: number; nonceErrors: number; byMethod: Record<string, { ok: number; failed: number }> }
  txSuccess: number
  relay: { received: number; p50Ms: number; p95Ms: number; maxMs: number; bridgeErrors: number }
  failures: string[]
  thresholds: typeof LOAD_THRESHOLDS
  pass: boolean
}

// Counts every write the agents make. A simulated BelowClearing costs no gas and sends no tx, so it is not a failure.
function counted(chain: FakeChain, w: LoadReport["writes"], failures: string[]): ChainAdapter {
  return new Proxy(chain, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv)
      if (typeof v !== "function") return v
      const name = String(prop)
      if (!WRITES.has(name)) return v.bind(target)
      return async (...args: unknown[]) => {
        const m = (w.byMethod[name] ??= { ok: 0, failed: 0 })
        try {
          const r = await v.apply(target, args)
          w.attempted++
          w.ok++
          m.ok++
          return r
        } catch (e) {
          if (e instanceof ChainError && e.code === "BelowClearing") {
            w.simulatedRejects++
            throw e
          }
          w.attempted++
          w.failed++
          m.failed++
          const msg = e instanceof Error ? e.message : String(e)
          if (/nonce/i.test(msg)) w.nonceErrors++
          if (failures.length < 20) failures.push(`${name}: ${msg.slice(0, 160)}`)
          throw e
        }
      }
    },
  }) as unknown as ChainAdapter
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!
}

// 50 agents, 6 lots kept open (a settled lot is listed again), real relay over a real WebSocket, FakeChain at 200 ms blocks.
export async function runLoad(o: { agents?: number; durationMs: number; blockMs?: number; tickMs?: number; rules?: Partial<SectorRules> }): Promise<LoadReport> {
  const agentsWanted = o.agents ?? 50
  const blockMs = o.blockMs ?? 200
  const token = "load-test-token"
  const failures: string[] = []
  const writes: LoadReport["writes"] = { attempted: 0, ok: 0, failed: 0, simulatedRejects: 0, nonceErrors: 0, byMethod: {} }

  const wallets = new Wallets(generateMnemonic(english))
  const fake = new FakeChain({ params: protocolParams(parseConfig({})), accountFor: wallets.accountFor })
  const chain = counted(fake, writes, failures)

  // Relay in-process: the same server, state and mapper as `pnpm -F relay start` in fake mode.
  const state = new RelayState()
  const currencies: Record<string, string> = Object.fromEntries(Object.entries(fake.currencies).map(([k, v]) => [lc(v), k]))
  const relay = buildRelay({ state, token, logger: false, mapper: new ChainMapper({ currencyOf: (a) => currencies[lc(a)] ?? a, nameOf: (a) => state.nameOf(a) }) })
  await relay.app.listen({ port: 0, host: "127.0.0.1" })
  const port = (relay.app.server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`

  const lat: number[] = []
  let bridgeErrors = 0
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  ws.addEventListener("message", (m) => {
    const env = JSON.parse(String(m.data)) as TownEnvelope
    lat.push(Date.now() - env.ts)
  })
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res(), { once: true })
    ws.addEventListener("error", () => rej(new Error("relay websocket did not open")), { once: true })
  })

  const publisher = new RelayPublisher(url, token)
  const bridge = new ChainBridge(url, token, () => bridgeErrors++)
  fake.watch((e) => bridge.forward(e))

  const runtime = new AgentRuntime({ chain, wallets, publisher, strategy: ruleStrategy, markProven: (a) => fake.markProven(a, true) })
  runtime.addPersonas(PERSONAS)
  // Extra buyers up to the target count, spread over the six lot kinds.
  for (let i = 0; runtime.agents.size < agentsWanted; i++) {
    const k = LOAD_LOTS[i % LOAD_LOTS.length]!
    const c: Currency = k.spec.currency
    runtime.addAgent({
      name: `Load buyer ${i + 1}`,
      role: "BUYER",
      kind: "buyer",
      building: "town_gate",
      sprite: "trader",
      currency: c,
      budget: toBase("5000"),
      mandate: { commodities: [k.spec.commodity as Commodity], maxPerUnit: ((k.spec.floorPerUnit * 14n) / 10n).toString(), avoidNoShowSellers: true },
    })
  }
  await runtime.bootstrap(undefined, ["pedro", "maya"])

  const engine = new SectorEngine({
    chain,
    wallets,
    publisher,
    runtime,
    references: loadReferences(),
    rules: { auctionBlocks: AUCTION_BLOCKS, pickupBlocks: PICKUP_BLOCKS, ...o.rules },
    onError: (what, e) => failures.length < 20 && failures.push(`engine ${what}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`),
  })

  // Keep every lot kind open: when one of ours settles, its seller lists the next.
  const ours = new Map<string, LotKind>()
  let listed = 0
  let settled = 0
  const listKind = async (k: LotKind) => {
    const r = await engine.listFor(k.seller, k.spec, `Load lot ${listed + 1}`)
    ours.set(r.lotId.toString(), k)
    listed++
  }
  fake.watch((e: ChainEvent) => {
    if (e.eventName !== "LotSettled") return
    const k = ours.get(e.args.lotId.toString())
    if (!k) return
    ours.delete(e.args.lotId.toString())
    settled++
    void listKind(k).catch((err) => failures.length < 20 && failures.push(`relist ${k.spec.commodity}: ${String(err).slice(0, 160)}`))
  })

  const stopRuntime = runtime.start(o.tickMs ?? 1000)
  const stopEngine = engine.start(500)
  const startBlock = fake.currentBlock
  for (const k of LOAD_LOTS) await listKind(k)
  const stopMining = fake.autoMine(blockMs)

  await new Promise((r) => setTimeout(r, o.durationMs))

  stopMining()
  stopRuntime()
  stopEngine()
  await engine.idle()
  await new Promise((r) => setTimeout(r, 500)) // let the last relay messages arrive
  ws.close()
  await relay.app.close()

  const bids = runtime.log.filter((d) => d.result.status === "bid").length
  const txSuccess = writes.attempted ? writes.ok / writes.attempted : 1
  const report: LoadReport = {
    chain: "fake (FakeChain, 200 ms blocks)",
    agents: runtime.agents.size,
    openLots: LOAD_LOTS.length,
    minutes: o.durationMs / 60_000,
    blocks: (fake.currentBlock - startBlock).toString(),
    lotsListed: listed,
    lotsSettled: settled,
    bids,
    writes,
    txSuccess,
    relay: { received: lat.length, p50Ms: pct(lat, 0.5), p95Ms: pct(lat, 0.95), maxMs: lat.length ? Math.max(...lat) : 0, bridgeErrors },
    failures,
    thresholds: LOAD_THRESHOLDS,
    pass: false,
  }
  report.pass = txSuccess >= LOAD_THRESHOLDS.txSuccess && writes.nonceErrors <= LOAD_THRESHOLDS.nonceErrors && report.relay.p95Ms < LOAD_THRESHOLDS.relayP95Ms && lat.length > 0
  return report
}

export function loadMarkdown(r: LoadReport): string {
  const ok = (b: boolean) => (b ? "pass" : "FAIL")
  return [
    `# Load test (S2 6.2)`,
    ``,
    `Chain: ${r.chain}. Agents: ${r.agents}. Lots kept open: ${r.openLots}. Duration: ${r.minutes} min (${r.blocks} blocks). Overall: **${r.pass ? "PASS" : "FAIL"}**.`,
    ``,
    `| Metric | Value | Threshold | Result |`,
    `| --- | --- | --- | --- |`,
    `| Tx success | ${(r.txSuccess * 100).toFixed(2)}% (${r.writes.ok}/${r.writes.attempted}) | >= ${r.thresholds.txSuccess * 100}% | ${ok(r.txSuccess >= r.thresholds.txSuccess)} |`,
    `| Nonce errors | ${r.writes.nonceErrors} | ${r.thresholds.nonceErrors} | ${ok(r.writes.nonceErrors <= r.thresholds.nonceErrors)} |`,
    `| Relay p95 | ${r.relay.p95Ms} ms (p50 ${r.relay.p50Ms}, max ${r.relay.maxMs}, ${r.relay.received} envelopes) | < ${r.thresholds.relayP95Ms} ms | ${ok(r.relay.p95Ms < r.thresholds.relayP95Ms)} |`,
    ``,
    `Lots listed ${r.lotsListed}, settled ${r.lotsSettled}. Bids ${r.bids}. Simulated below-clearing rejects (no tx): ${r.writes.simulatedRejects}. Relay bridge errors: ${r.relay.bridgeErrors}.`,
    ``,
    `Writes by method: ${Object.entries(r.writes.byMethod).map(([k, v]) => `${k} ${v.ok}${v.failed ? `/${v.failed} failed` : ""}`).join(", ")}.`,
    ...(r.failures.length ? ["", "## Failures (first 20)", "", ...r.failures.map((f) => `- ${f}`)] : []),
    ``,
  ].join("\n")
}


