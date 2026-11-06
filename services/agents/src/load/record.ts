import type { TownEnvelope, TownEvent } from "@fairtown/shared"
import { TownEnvelope as TownEnvelopeSchema } from "@fairtown/shared/protocol"
import { english, generateMnemonic } from "viem/accounts"
import { ChainMapper } from "../../../relay/src/mapping"
import type { ChainEvent, ProtocolParams } from "../chain/types"
import { FakeChain } from "../chain/fake/FakeChain"
import { Director, fakeSignals } from "../director/director"
import { PERSONAS } from "../fixtures/personas"
import { loadCalendar } from "../humans/routes"
import { findReference, loadReferences } from "../listing/references"
import { MarketState } from "../market/state"
import type { Publisher } from "../runtime/publisher"
import { AgentRuntime } from "../runtime/runtime"
import { Wallets } from "../runtime/wallets"
import { SectorEngine } from "../sectors/engine"
import { AUCTION_BLOCKS_FAKE, PICKUP_BLOCKS } from "../sectors/rules"
import { ruleStrategy } from "../strategies/rule"

const BASE_TS = Date.UTC(2026, 10, 6, 23, 30) // same day start as fixtures/day.jsonl
const BLOCK_MS = 2000 // fake-mode block time, so replay at speed 1 plays in real fake-mode time
// D-12 windows (fake mode): the D-50 values divided by 10.
const PARAMS: ProtocolParams = { feeBps: 100n, advanceNewBps: 5000, advanceProvenBps: 9000, advanceTruckBps: 1000, provenAfter: 3, contestWindowBlocks: 60n, reportWindowBlocks: 300n }
const PICKUP_FAKE = Object.fromEntries(Object.entries(PICKUP_BLOCKS).map(([k, v]) => [k, v / 10n])) as typeof PICKUP_BLOCKS
const TERMINAL = new Set(["paid_in_full", "refunded", "relisted", "unsold"])
const lc = (a: string) => a.toLowerCase()

export type Recording = { envelopes: TownEnvelope[]; blocks: number; lots: Record<string, string>; counts: Record<string, number> }

// Runs `full_day` on FakeChain as fast as it can mine and records what the town would see: agent events from the
// publisher, chain events through the relay's own mapper, a clock every 25 blocks. Timestamps follow blocks.
export async function recordDay(o: { maxBlocks?: number; speed?: number } = {}): Promise<Recording> {
  const maxBlocks = o.maxBlocks ?? 4000
  const wallets = new Wallets(generateMnemonic(english))
  const chain = new FakeChain({ params: PARAMS, accountFor: wallets.accountFor })
  const tsAt = (block: number | bigint) => BASE_TS + Number(block) * BLOCK_MS
  const out: TownEnvelope[] = []
  let q: Promise<void> = Promise.resolve()
  let seq = 0
  const push = (envs: TownEnvelope[]) => {
    for (const e of envs) out.push(TownEnvelopeSchema.parse(e))
  }

  const names = new Map<string, string>()
  const currencies = Object.fromEntries(Object.entries(chain.currencies).map(([k, v]) => [lc(v), k]))
  const mapper = new ChainMapper({ currencyOf: (a) => currencies[lc(a)] ?? a, nameOf: (a) => names.get(lc(a)), now: () => tsAt(chain.currentBlock) })
  chain.watch((e: ChainEvent) => {
    q = q.then(async () => {
      push(await mapper.map(e as never))
      if (e.eventName === "LotSettled") mapper.forget(e.args.lotId)
    })
  })
  const publisher: Publisher = {
    async publish(events: TownEvent[], block?: number) {
      const b = block ?? Number(chain.currentBlock)
      for (const event of events) {
        if (event.type === "agent.spawned") names.set(lc(event.agentId), event.name)
        q = q.then(() => push([{ v: 1, id: `rec-${String(++seq).padStart(5, "0")}`, ts: tsAt(b), block: b, source: "agents", event }]))
      }
    },
  }

  const references = loadReferences()
  const market = new MarketState({ chain, references })
  market.start()
  const runtime = new AgentRuntime({
    chain,
    wallets,
    publisher,
    strategy: ruleStrategy,
    now: () => tsAt(chain.currentBlock),
    markProven: (a) => chain.markProven(a, true),
    nameOf: (a) => names.get(lc(a)),
    marketFor: (lot, block) => {
      const r = findReference(references, lot.commodity, lot.place)
      return { ...(r && r.currency === lot.currency ? { reference: BigInt(r.perUnit) } : {}), signals: market.signalsFor(lot.place, lot.sector, block), urgencyBps: market.urgencyBps(lot.place, lot.sector, block) }
    },
  })
  runtime.addPersonas(PERSONAS)
  await runtime.bootstrap(undefined, PERSONAS.filter((p) => p.seeded?.proven).map((p) => p.id))
  const engine = new SectorEngine({ chain, wallets, publisher, runtime, references, rules: { auctionBlocks: AUCTION_BLOCKS_FAKE, pickupBlocks: PICKUP_FAKE, arriveBlocks: 3n, travelBlocks: 10n } })
  runtime.watchOnly()
  engine.watchOnly()
  const director = new Director({ chain, engine, signals: fakeSignals(chain), signalBlocks: 300n, festivals: loadCalendar().events, today: () => new Date(BASE_TS) })
  await director.start("full_day", o.speed ?? 1)

  const sceneSellers = ["ingrid", "maya", "northlight", "ganesh", "wanjiru", "amina", "coastal_catch"].map((id) => wallets.address(PERSONAS.findIndex((p) => p.id === id)))
  const lots = new Map<string, string>()
  let blocks = 0
  for (; blocks < maxBlocks; blocks++) {
    await director.step()
    if (blocks % 2 === 0) await runtime.step()
    await engine.step()
    chain.mine(1)
    const b = Number(chain.currentBlock)
    if (b % 25 === 0) q = q.then(() => push([{ v: 1, id: `clock-${b}`, ts: tsAt(b), block: b, source: "chain", event: { type: "clock", block: b } }]))
    await engine.idle()
    await q
    if (blocks % 50 === 0 && director.status().running.length === 0) {
      // Done when every scene seller has listed and every lot (chained truck and storage lots too) has an outcome.
      const listed = chain.log.filter((e) => e.eventName === "LotListed")
      for (const e of listed) if (e.eventName === "LotListed") lots.set(e.args.lotId.toString(), (await chain.getLot(e.args.lotId)).status)
      const sellersDone = sceneSellers.every((a) => listed.some((e) => e.eventName === "LotListed" && lc(e.args.seller) === a))
      if (sellersDone && [...lots.values()].every((s) => TERMINAL.has(s))) break
    }
  }
  await q
  const counts: Record<string, number> = {}
  for (const e of out) counts[e.event.type] = (counts[e.event.type] ?? 0) + 1
  return { envelopes: out, blocks, lots: Object.fromEntries(lots), counts }
}
