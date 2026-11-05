import { loadEnv } from "@fairtown/shared/env"
import { fileURLToPath } from "node:url"
import { createAdapters } from "./adapters"
import { parseAiConfig } from "./ai/config"
import { createGateway } from "./ai/gateway"
import { parseConfig } from "./config"
import { buildApp } from "./server"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const config = parseConfig(env)
const ai = createGateway({ config: parseAiConfig(env) })
const { chain, arkiv, stop } = createAdapters(config)
const app = buildApp({ config, chain, arkiv, ai })

await app.listen({ port: config.AGENTS_PORT, host: "0.0.0.0" })

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    stop()
    await app.close()
    process.exit(0)
  })
}
