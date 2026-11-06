import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Address } from "viem"
import { english, generateMnemonic } from "viem/accounts"
import { createAdapters, FAKE_BLOCK_MS } from "./adapters"
import { parseAiConfig } from "./ai/config"
import { createGateway } from "./ai/gateway"
import { LedgerWriter } from "./arkiv/ledgerWriter"
import { parseConfig } from "./config"
import { PERSONAS } from "./fixtures/personas"
import { DraftStore } from "./listing/drafts"
import { PhotoStore } from "./listing/photos"
import { loadReferences } from "./listing/references"
import { ChainBridge, RelayPublisher } from "./runtime/publisher"
import { AgentRuntime } from "./runtime/runtime"
import { Wallets } from "./runtime/wallets"
import { SellerDirectory } from "./sellers"
import { buildApp } from "./server"
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
const stopRuntime = runtime.start()
const stopMining = fake ? fake.autoMine(FAKE_BLOCK_MS) : () => {}

const app = buildApp({ config, chain, arkiv, ai, listing, runtime })
log = (msg, extra) => app.log.warn(extra ?? {}, msg)
await app.listen({ port: config.AGENTS_PORT, host: "0.0.0.0" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    stopMining()
    stopRuntime()
    stopLedger()
    await app.close()
    process.exit(0)
  })
}
