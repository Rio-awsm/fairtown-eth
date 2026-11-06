import { loadEnv } from "@fairtown/shared/env"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { loadDeployment } from "@fairtown/shared/addresses"
import { ChainWatcher } from "./chainWatcher"
import { parseRelayConfig } from "./config"
import { ChainMapper } from "./mapping"
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
const state = new RelayState()
const fake = config.CHAIN_MODE === "fake"
const fakeCurrencies: Record<string, string> = {
  "0xc000000000000000000000000000000000000001": "USD",
  "0xc000000000000000000000000000000000000002": "EUR",
  "0xc000000000000000000000000000000000000003": "USDC",
}
const relay = buildRelay({
  state,
  token: config.RELAY_INTERNAL_TOKEN,
  ...(fake ? { mapper: new ChainMapper({ currencyOf: (a) => fakeCurrencies[a] ?? a, nameOf: (a) => state.nameOf(a) }) } : {}),
})
await relay.app.listen({ port: config.RELAY_PORT, host: "0.0.0.0" })
if (config.RELAY_INTERNAL_TOKEN === "change-me")
  relay.app.log.warn("RELAY_INTERNAL_TOKEN is still the default; set your own before a public demo")

let watcher: ChainWatcher | undefined
if (!fake) {
  if (!config.RPC_URL) throw new Error(`CHAIN_MODE=${config.CHAIN_MODE} needs RPC_URL`)
  watcher = new ChainWatcher({
    deployment: await loadDeployment(config.CHAIN_MODE as "anvil" | "base-sepolia"),
    rpcUrl: config.RPC_URL,
    ...(config.RPC_WS_URL ? { wsUrl: config.RPC_WS_URL } : {}),
    ...(config.LOGS_RPC_URL ? { logsRpcUrl: config.LOGS_RPC_URL } : {}),
    publish: (envs) => relay.publish(envs),
    nameOf: (a) => state.nameOf(a),
    onError: (where, e) => relay.app.log.warn({ where, err: e instanceof Error ? e.message.replace(/https?:\/\/\S+|wss?:\/\/\S+/g, "<rpc>").slice(0, 200) : String(e) }, "chain watcher"),
  })
  await watcher.start()
  relay.app.log.info(`watching ${config.CHAIN_MODE} from block ${watcher.head}`)
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    watcher?.stop()
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
