import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createAdapters, FAKE_BLOCK_MS } from "./adapters"
import { parseAiConfig } from "./ai/config"
import { createGateway } from "./ai/gateway"
import { LedgerWriter } from "./arkiv/ledgerWriter"
import { bootstrapFake } from "./bootstrap"
import { parseConfig } from "./config"
import { PERSONAS } from "./fixtures/personas"
import { DraftStore } from "./listing/drafts"
import { PhotoStore } from "./listing/photos"
import { loadReferences } from "./listing/references"
import { SellerDirectory } from "./sellers"
import { buildApp } from "./server"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const config = parseConfig(env)
const ai = createGateway({ config: parseAiConfig(env) })
const { chain, arkiv, writer, fake } = createAdapters(config)
const sellers = new SellerDirectory(PERSONAS)
let stopMining = () => {}
if (fake) {
  await bootstrapFake(fake, sellers, PERSONAS)
  stopMining = fake.autoMine(FAKE_BLOCK_MS)
}
const listing = {
  ai,
  sellers,
  photos: new PhotoStore(resolve(root, config.STORAGE_DIR)),
  drafts: new DraftStore(),
  references: loadReferences(),
}
const ledger = new LedgerWriter({
  chain,
  arkiv,
  writer,
  detailsFor: (uri) => {
    const d = listing.drafts.get(uri.split("/").pop() ?? "")
    return d && { grade: d.grade.grade, gradeReport: d.grade, photos: d.photos.map((p) => p.hash), requestId: d.trace?.requestId, teeVerified: d.trace?.teeVerified }
  },
  onError: (e, event) => app.log.warn({ event, err: e instanceof Error ? e.message : String(e) }, "arkiv write failed"),
})
const stopLedger = ledger.start()
const app = buildApp({ config, chain, arkiv, ai, listing })

await app.listen({ port: config.AGENTS_PORT, host: "0.0.0.0" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    stopMining()
    stopLedger()
    await app.close()
    process.exit(0)
  })
}
