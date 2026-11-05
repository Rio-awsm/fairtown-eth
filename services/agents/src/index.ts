import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createAdapters, FAKE_BLOCK_MS } from "./adapters"
import { parseAiConfig } from "./ai/config"
import { createGateway } from "./ai/gateway"
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
const { chain, arkiv, fake } = createAdapters(config)
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
const app = buildApp({ config, chain, arkiv, ai, listing })

await app.listen({ port: config.AGENTS_PORT, host: "0.0.0.0" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    stopMining()
    await app.close()
    process.exit(0)
  })
}
