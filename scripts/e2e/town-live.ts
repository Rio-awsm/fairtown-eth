/**
 * C 1.2 e2e: the town reacts to real events. Starts the anvil fork, keeper, agents, relay and web, then runs the live
 * Playwright spec (apps/web/e2e-live) in a laptop Chrome viewport. `pnpm e2e:town-live`. TEST MONEY.
 */
import { spawn } from "node:child_process"
import { API, Run, root, startStack, WEB_PORT } from "./stack"

const run = new Run("e2e-town-live", "anvil")
console.log("Fairtown e2e:town-live on anvil (TEST MONEY)")
await startStack(run, { relay: true, web: true })

const code = await new Promise<number>((resolve) => {
  const pw = spawn("pnpm", ["-s", "-F", "web", "exec", "playwright", "test", "-c", "playwright.live.config.ts"], {
    cwd: root,
    env: { ...process.env, E2E_API_URL: API, E2E_WEB_URL: `http://localhost:${WEB_PORT}` },
    stdio: ["ignore", "inherit", "inherit"],
  })
  pw.on("exit", (c) => resolve(c ?? 1))
})
run.stop()
if (code !== 0) run.fail(`Playwright exited with code ${code}`)
console.log(`\nE2E TOWN-LIVE PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s`)
console.log(`  service logs: ${run.runDir}`)
process.exit(0)
