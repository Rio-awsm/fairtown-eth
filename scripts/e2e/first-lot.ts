/**
 * C 1.3 e2e: the first full lot, phone to QR handover to paid in full, laptop-first (D-118). Starts the stack on the
 * anvil fork at Base pace (~5 blocks/s) and runs apps/web/e2e-live/first-lot.spec.ts: phone-sized /sell, phone-sized
 * /scan (fallback link, no camera), desktop /town. The run is recorded to docs/demo/fallback/first-lot/ (fallback
 * video, guide C 1.3 and C 3.1 level 5). `pnpm e2e:first-lot`. TEST MONEY.
 */
import { rmSync } from "node:fs"
import { env, root, Run, runPlaywright, startStack } from "./stack"

const run = new Run("e2e-first-lot", "anvil")
console.log("Fairtown e2e:first-lot on anvil (TEST MONEY)")
if (!env.SELLER_PIN) throw new Error("SELLER_PIN is unset in .env: the seller cannot open a session")
const videoDir = `${root}docs/demo/fallback/first-lot`
rmSync(videoDir, { recursive: true, force: true })
await startStack(run, { relay: true, web: true, baseSpeed: true })
const code = await runPlaywright("e2e-live/first-lot.spec.ts", { E2E_SELLER_PIN: env.SELLER_PIN, E2E_VIDEO_DIR: videoDir })
run.stop()
if (code !== 0) run.fail(`Playwright exited with code ${code}`)
console.log(`\nE2E FIRST-LOT PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s`)
console.log(`  fallback video: docs/demo/fallback/first-lot/ (town, seller, scanner)`)
console.log(`  service logs: ${run.runDir}`)
process.exit(0)
