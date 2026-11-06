import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { createAdapters, FAKE_BLOCK_MS } from "./adapters"
import { parseAiConfig } from "./ai/config"
import { createGateway } from "./ai/gateway"
import { LedgerWriter } from "./arkiv/ledgerWriter"
import { parseConfig, pickupWindowFor, protocolParams } from "./config"
import { PERSONAS } from "./fixtures/personas"
import { DraftStore } from "./listing/drafts"
import { PhotoStore } from "./listing/photos"
import { loadReferences } from "./listing/references"
import { ChainBridge, RelayPublisher } from "./runtime/publisher"
import { AgentRuntime } from "./runtime/runtime"
import { Wallets } from "./runtime/wallets"
import { SellerDirectory } from "./sellers"
import { buildApp } from "./server"
import { fileDispute, fixtureDisputePhotos } from "./handover/disputes"
import { SectorEngine } from "./sectors/engine"
import { MarketState, moveOnSignal } from "./market/state"
import { SessionStore } from "./handover/sessions"
import { creBridgeSignals, Director, fakeSignals } from "./director/director"
import { loadCalendar } from "./humans/routes"
import { findReference } from "./listing/references"
import { AUCTION_BLOCKS, AUCTION_BLOCKS_FAKE } from "./sectors/rules"
import { SECTORS } from "@fairtown/shared"
import { createLlmStrategy, marketContext } from "./strategies/llm"
import { ruleStrategy } from "./strategies/rule"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const config = parseConfig(env)
const aiConfig = parseAiConfig(env)
const ai = createGateway({ config: aiConfig })

if (!config.AGENT_MNEMONIC && config.CHAIN_MODE !== "fake") throw new Error("AGENT_MNEMONIC is required outside CHAIN_MODE=fake")
const wallets = new Wallets(config.AGENT_MNEMONIC ?? generateMnemonic(english))
const { chain, arkiv, writer, fake, viem } = await createAdapters(config, wallets.accountFor)
const sellers = new SellerDirectory(PERSONAS, (p) => wallets.address(PERSONAS.indexOf(p)))

const drafts = new DraftStore()
const listing = { ai, sellers, photos: new PhotoStore(resolve(root, config.STORAGE_DIR)), drafts, references: loadReferences() }
let log: (msg: string, extra?: object) => void = () => {}

const ledger = new LedgerWriter({
  chain,
  arkiv,
  writer,
  detailsFor: (uri) => {
    const d = drafts.get(uri.split("/").pop() ?? "")
    return d && { grade: d.grade.grade, gradeReport: d.grade, photos: d.photos.map((p) => p.hash), requestId: d.trace?.requestId, teeVerified: d.trace?.teeVerified }
  },
  onError: (e, event) => log("arkiv write failed", { event, err: e instanceof Error ? e.message : String(e) }),
})
const publisher = new RelayPublisher(`http://localhost:${config.RELAY_PORT}`, config.RELAY_INTERNAL_TOKEN)
// Live signals, reference and FX (S2 5.3). Shares the reference rows with listing, sectors and the LLM context.
const market = new MarketState({
  chain,
  references: listing.references,
  onSignal: (s, sectors) => void moveOnSignal(s, sectors, runtime.agents.values(), (ev) => publisher.publish(ev)).catch((e) => log("signal move failed", { err: String(e) })),
})
const marketFor = (lot: { commodity: string; place: string; sector: (typeof SECTORS)[number]; currency: string }, block: bigint) => {
  const r = findReference(listing.references, lot.commodity, lot.place)
  return {
    ...(r && r.currency === lot.currency ? { reference: BigInt(r.perUnit) } : {}),
    signals: market.signalsFor(lot.place, lot.sector, block),
    urgencyBps: market.urgencyBps(lot.place, lot.sector, block),
  }
}

// MOCK_AI=1: rules decide (FakeAi has no bidder). Otherwise the LLM advises and rules are the fallback.
const strategy = aiConfig.MOCK_AI
  ? ruleStrategy
  : createLlmStrategy({
      ai,
      context: marketContext({ references: listing.references, arkiv }),
      ...(fake ? { blockMs: FAKE_BLOCK_MS } : {}),
      onFallback: (code, a) => log("bidder fell back to rules", { code, agent: a.name }),
    })
const runtime = new AgentRuntime({
  chain,
  wallets,
  publisher,
  strategy,
  marketFor,
  ledger,
  gradeFor: (_id, uri) => drafts.get(uri.split("/").pop() ?? "")?.grade.grade,
  nameOf: (a: Address) => sellers.byAddr(a)?.name,
  ...(fake ? { markProven: (a: Address) => fake.markProven(a, true) } : {}),
  ...(viem ? { markProven: (a: Address) => viem.markProven(a, true), gasTopUpWei: 5n * 10n ** 14n } : {}),
})
runtime.addPersonas(PERSONAS)

const stopLedger = ledger.start()
if (fake) {
  const bridge = new ChainBridge(`http://localhost:${config.RELAY_PORT}`, config.RELAY_INTERNAL_TOKEN)
  chain.watch((e) => bridge.forward(e))
}
await runtime.bootstrap(undefined, PERSONAS.filter((p) => p.seeded?.proven).map((p) => p.id))
const stopMarket = market.start()
const stopRuntime = runtime.start()

// Fake mode mines a block every 2 s (not 200 ms), so it uses the D-12 durations and windows (D-50 divided by 10).
const disputes = { chain, wallets, photos: listing.photos, drafts, baseUrl: config.PUBLIC_BASE_URL }
const sectors = new SectorEngine({
  chain,
  wallets,
  publisher,
  runtime,
  references: listing.references,
  rules: {
    auctionBlocks: fake ? AUCTION_BLOCKS_FAKE : AUCTION_BLOCKS,
    pickupBlocks: Object.fromEntries(SECTORS.map((s) => [s, fake ? pickupWindowFor(config, s) / 10n : pickupWindowFor(config, s)])) as Record<(typeof SECTORS)[number], bigint>,
    relistStepBps: config.RELIST_STEP_BPS,
    ...(fake ? { arriveBlocks: 3n, travelBlocks: 10n } : {}),
  },
  fileDispute: (buyer, lotId, tokens) => fileDispute(disputes, buyer, lotId, tokens, fixtureDisputePhotos(lotId)),
  onError: (what, err) => log("sector step failed", { what, err: err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "<url>") : String(err) }),
})
const stopSectors = sectors.start()

// Scenes: FakeChain gets signals directly; a real chain goes through S1's CRE bridge (S1 4.5) when it is up.
const director = new Director({
  chain,
  engine: sectors,
  signals: fake ? fakeSignals(fake) : creBridgeSignals(`http://localhost:${config.CRE_BRIDGE_PORT}`, config.CRE_BRIDGE_TOKEN ?? ""),
  signalBlocks: fake ? 300n : 3000n,
  festivals: loadCalendar().events,
})
const stopDirector = director.begin()
const stopMining = fake ? fake.autoMine(FAKE_BLOCK_MS) : () => {}

// Handover codes live about 5 minutes: 1500 blocks at 200 ms, 150 in fake mode (2 s blocks).
const sessions = new SessionStore()
const app = buildApp({
  config,
  chain,
  arkiv,
  ai,
  listing,
  runtime,
  disputes,
  market: { market, arkiv, chain, references: listing.references, sellers, params: protocolParams(config) },
  handover: { chain, wallets, runtime, sellers, sessions, photos: listing.photos, drafts, config, ticketValidBlocks: fake ? 150n : 1500n },
  humans: { runtime, publisher, sessions, ai, blockNumber: () => chain.blockNumber(), config },
  director,
})
log = (msg, extra) => app.log.warn(extra ?? {}, msg)
await app.listen({ port: config.AGENTS_PORT, host: "0.0.0.0" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    stopMining()
    stopRuntime()
    stopSectors()
    stopMarket()
    stopDirector()
    stopLedger()
    await app.close()
    process.exit(0)
  })
}
