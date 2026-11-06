/**
 * `pnpm dev:all [--network base-sepolia]`: the whole stack for the laptop (C 1.2). Anvil fork by default (local gas,
 * Arkiv in memory, rule bidders, D-114), or Base Sepolia with live Arkiv and the LLM. Runs until Ctrl-C.
 * Service logs go to .data/e2e/dev-all-<network>-<time>/. TEST MONEY.
 */
import { parseNetwork, Run, startStack, WEB_PORT } from "./e2e/stack"

const network = parseNetwork(process.argv, "dev:all")
const run = new Run("dev-all", network)
console.log(`Fairtown dev:all on ${network} (TEST MONEY)`)
await startStack(run, { relay: true, web: true })
console.log(`\nReady. Town: http://localhost:${WEB_PORT}/town   Sell: http://localhost:${WEB_PORT}/sell`)
console.log(`Logs: ${run.runDir}\nCtrl-C stops everything.`)
process.removeAllListeners("SIGINT")
process.on("SIGINT", () => {
  run.stop()
  process.exit(0)
})
await new Promise(() => {})
