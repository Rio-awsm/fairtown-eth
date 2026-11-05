import { loadEnv } from "@fairtown/shared/env"
import { fileURLToPath } from "node:url"
import { createAdapters } from "./adapters"
import { parseConfig } from "./config"
import { buildApp } from "./server"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const config = parseConfig(loadEnv(`${root}.env`).env)
const { chain, arkiv, stop } = createAdapters(config)
const app = buildApp({ config, chain, arkiv })

await app.listen({ port: config.AGENTS_PORT, host: "0.0.0.0" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    stop()
    await app.close()
    process.exit(0)
  })
}
