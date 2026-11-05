import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { parseRelayConfig } from "./config"
import { readJsonl, replay } from "./replay"
import { buildRelay } from "./server"
import { RelayState } from "./state"

const argv = process.argv.slice(2)
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: { replay: { type: "string" }, speed: { type: "string", default: "1" } },
})

const root = fileURLToPath(new URL("../../../", import.meta.url))
const config = parseRelayConfig(loadEnv(`${root}.env`).env)
const relay = buildRelay({ state: new RelayState(), token: config.RELAY_INTERNAL_TOKEN })
await relay.app.listen({ port: config.RELAY_PORT, host: "0.0.0.0" })
if (config.RELAY_INTERNAL_TOKEN === "change-me")
  relay.app.log.warn("RELAY_INTERNAL_TOKEN is still the default; set your own before a public demo")

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await relay.app.close()
    process.exit(0)
  })
}

if (values.replay) {
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), values.replay)
  const envs = await readJsonl(file)
  const speed = Number(values.speed)
  relay.app.log.info(`replaying ${envs.length} envelopes from ${file} at ${speed}x`)
  await replay(envs, (env) => relay.publish([env]), { speed })
  relay.app.log.info("replay finished")
}
