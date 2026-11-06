import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { createAdapters, FAKE_BLOCK_MS } from "./adapters"
import { parseAiConfig } from "./ai/config"
import { createGateway } from "./ai/gateway"
import { verificationOf } from "./ai/verification"
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
import { SwarmStore } from "./addons/swarm/store"
import { DEFAULT_POLICY, hederaClient, IntelBuyer, intelLine, mirrorBalances } from "./addons/hedera/buyer"
import { intelServer } from "./addons/hedera/intel"
import { EnsAgents } from "./addons/ens/agents"
import { EnsClient } from "./addons/ens/client"
import { existsSync, readFileSync } from "node:fs"
import { privateKeyToAccount } from "viem/accounts"
import { ChainFeed, withFeed } from "./chain/feed"
import { healthExtras } from "./health"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
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
const adapters = await createAdapters(config, wallets.accountFor)
const { arkiv, writer, fake, viem } = adapters
// Base Sepolia: one shared watcher that starts a lookback before the head, so a restart rebuilds every component.
const startHead = viem ? await viem.blockNumber() : 0n
const feed = viem ? new ChainFeed(viem, startHead > config.CHAIN_BACKFILL_BLOCKS ? startHead - config.CHAIN_BACKFILL_BLOCKS : 0n) : undefined
const chain = feed ? withFeed(adapters.chain, feed) : adapters.chain
const stopFeed = feed?.start() ?? (() => {})
const sellers = new SellerDirectory(PERSONAS, (p) => wallets.address(PERSONAS.indexOf(p)))

const drafts = new DraftStore()
// ADDON_SWARM: lot photos also go to Swarm (S2 8.5); local disk stays the primary copy, so a missing node changes nothing.
const swarm = config.ADDON_SWARM ? new SwarmStore({ beeUrl: config.SWARM_BEE_URL, ...(config.SWARM_BATCH_ID ? { batchId: config.SWARM_BATCH_ID } : {}), gateway: config.SWARM_GATEWAY }) : undefined

// Floors use the last clears on the Arkiv ledger; if Arkiv is down the floor falls back to the reference.
const recentPrices = async (commodity: string, place: string) => {
  try {
    const page = await arkiv.query(ARKIV_SCHEMAS.price, { commodity, place }, { limit: 10, orderBy: { field: "lotId", dir: "desc" } })
    return page.entities.map((e) => BigInt(e.values.finalClearingPerUnit as bigint)).reverse()
  } catch {
    return []
  }
}
const listing = { ai, sellers, photos: new PhotoStore(resolve(root, config.STORAGE_DIR)), drafts, references: loadReferences(), recentPrices, ...(swarm ? { swarm } : {}) }
let log: (msg: string, extra?: object) => void = () => {}

const ledger = new LedgerWriter({
  chain,
  arkiv,
  writer,
  detailsFor: (uri) => {
    const d = drafts.get(uri.split("/").pop() ?? "")
    if (!d) return undefined
    // 0G trace on the public record: which model graded the lot, the Router's request id and provider, and the badge state.
    const v = verificationOf(d.trace)
    return {
      grade: d.grade.grade,
      gradeReport: d.grade,
      photos: d.photos.map((p) => p.hash),
      // Plain Swarm references only (an encrypted one would carry its key); readable at https://bzz.limo/bzz/<ref>/
      ...(d.photos.some((p) => p.swarmRef) ? { swarm: d.photos.filter((p) => p.swarmRef).map((p) => ({ hash: p.hash, ref: p.swarmRef })) } : {}),
      requestId: d.trace?.requestId,
      provider: d.trace?.provider,
      teeVerified: d.trace?.teeVerified,
      model: d.trace?.model,
      verification: v.state,
      ...(d.trace?.fallback ? { fallback: d.trace.fallback.reason } : {}),
    }
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
// ADDON_ENS: agent names on ENSv2 Sepolia (S2 8.2). Off by default; addresses work without it.
let ensAgents: EnsAgents | undefined
if (config.ADDON_ENS) {
  const stateFile = new URL("./addons/ens/sepolia.json", import.meta.url)
  if (!config.ENS_PRIVATE_KEY || !config.ENS_SEPOLIA_RPC_URL || !existsSync(stateFile)) log("ADDON_ENS=1 but ENS is not set up (run pnpm -F agents ens:setup); continuing without names")
  else {
    const ens = new EnsClient(config.ENS_SEPOLIA_RPC_URL, privateKeyToAccount(config.ENS_PRIVATE_KEY as `0x${string}`))
    ensAgents = new EnsAgents({
      ens,
      state: JSON.parse(readFileSync(stateFile, "utf8")),
      personas: PERSONAS,
      publish: (ev) => publisher.publish(ev),
      onError: (what, e) => log("ens failed", { what, err: e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "<rpc>").slice(0, 200) : String(e) }),
    })
  }
}

// ADDON_HEDERA: paid market intel over x402 on Hedera testnet (S2 8.4). The merchant is HEDERA_ACCOUNT_ID; buyer agents pay
// from HEDERA_AGENT_ACCOUNT_ID within per-agent budgets and an allowlist.
const hedera = config.ADDON_HEDERA && config.HEDERA_ACCOUNT_ID && config.HEDERA_AGENT_ACCOUNT_ID && config.HEDERA_AGENT_PRIVATE_KEY
const intelUrl = (c: string) => `${config.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/intel/${c}`
const intelBuyer = hedera
  ? new IntelBuyer({
      client: hederaClient(config.HEDERA_AGENT_ACCOUNT_ID!, config.HEDERA_AGENT_PRIVATE_KEY!),
      policy: DEFAULT_POLICY(config.HEDERA_ACCOUNT_ID!, new URL(config.PUBLIC_BASE_URL).host),
      balanceOf: mirrorBalances(config.HEDERA_AGENT_ACCOUNT_ID!),
    })
  : undefined
const intelFor = intelBuyer
  ? async (o: { agent: { agentId: string }; lot: { commodity: string } }) => {
      const r = await intelBuyer.buy(o.agent.agentId, intelUrl(o.lot.commodity), o.lot.commodity)
      if (!r.ok) log("intel not bought", { reason: r.reason })
      return r.ok ? intelLine(r.intel) : undefined
    }
  : undefined

const strategy = aiConfig.MOCK_AI
  ? ruleStrategy
  : createLlmStrategy({
      ai,
      context: marketContext({ references: listing.references, arkiv }),
      ...(fake ? { blockMs: FAKE_BLOCK_MS } : {}),
      onFallback: (code, a) => log("bidder fell back to rules", { code, agent: a.name }),
      ...(intelFor ? { intel: intelFor } : {}),
    })
const runtime = new AgentRuntime({
  chain,
  wallets,
  publisher,
  strategy,
  marketFor,
  ...(ensAgents ? { sellerCheck: (s: Address) => ensAgents!.sellerCheck(s), ensNameOf: (a: Address) => ensAgents!.nameOf(a) } : {}),
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
if (ensAgents) {
  chain.watch((e) => ensAgents!.onEvent(e))
  for (const a of runtime.agents.values()) void ensAgents.register(a) // background: about two Sepolia txs per agent
}
const stopRuntime = runtime.start()

// Fake mode mines a block every 2 s (not 200 ms), so it uses the D-12 durations and windows (D-50 divided by 10).
const disputes = { chain, wallets, photos: listing.photos, drafts, baseUrl: config.PUBLIC_BASE_URL }
const sectors = new SectorEngine({
  ...(feed ? { replayUntil: startHead, caughtUpTo: () => feed.caughtUpTo } : {}),
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
  humans: { runtime, publisher, sessions, ai, blockNumber: () => chain.blockNumber(), config, ...(ensAgents ? { onJoined: (a) => void ensAgents!.register(a) } : {}) },
  director,
  ...(hedera ? { intel: { server: intelServer(config.X402_FACILITATOR_URL), payTo: config.HEDERA_ACCOUNT_ID!, arkiv, market, block: () => chain.blockNumber(), onSettled: (tx: string) => log("intel payment settled", { tx }) } } : {}),
  health: healthExtras({ relayUrl: `http://localhost:${config.RELAY_PORT}`, ledger, ...(feed ? { feed } : {}), engine: sectors, runtime, ai, llmOn: !aiConfig.MOCK_AI, ...(swarm ? { swarm } : {}), ...(aiConfig.VISION_MODEL ? { visionModel: aiConfig.VISION_MODEL } : {}) }),
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
    stopFeed()
    stopLedger()
    await app.close()
    process.exit(0)
  })
}
