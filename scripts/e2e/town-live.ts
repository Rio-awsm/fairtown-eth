/**
 * C 1.2 e2e: the town reacts to real events. Starts the anvil fork, keeper, agents, relay and web, then runs the live
 * Playwright spec (apps/web/e2e-live/town-live.spec.ts) in a laptop Chrome viewport. `pnpm e2e:town-live`. TEST MONEY.
 */
import { Run, runPlaywright, startStack } from "./stack"

const run = new Run("e2e-town-live", "anvil")
console.log("Fairtown e2e:town-live on anvil (TEST MONEY)")
await startStack(run, { relay: true, web: true })
const code = await runPlaywright("e2e-live/town-live.spec.ts")
run.stop()
if (code !== 0) run.fail(`Playwright exited with code ${code}`)
console.log(`\nE2E TOWN-LIVE PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s`)
console.log(`  service logs: ${run.runDir}`)
process.exit(0)
