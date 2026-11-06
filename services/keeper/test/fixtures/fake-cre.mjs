#!/usr/bin/env node
// Fake `cre` for the bridge tests (S1 4.5). Behaviour from env:
//   FAKE_CRE_MODE  ok | fail | slow | noresult      FAKE_CRE_SLEEP_MS  for slow
//   FAKE_CRE_TRACE file to append "start|end <workflow> <trigger> <ms>" lines (concurrency checks)
//   FAKE_SECRET    printed, so the tests can prove the bridge redacts it
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const wf = args[2] ?? "?"
const trig = args[args.indexOf("--trigger-index") + 1] ?? "?"
const trace = (what) =>
  process.env.FAKE_CRE_TRACE && appendFileSync(process.env.FAKE_CRE_TRACE, `${what} ${wf} ${trig} ${Date.now()}\n`)
const mode = process.env.FAKE_CRE_MODE ?? "ok"
// authfail-once: the first call fails like the CLI's online login check, later calls succeed
if (mode === "authfail-once" && !existsSync(process.env.FAKE_CRE_ONCE_FILE)) {
  writeFileSync(process.env.FAKE_CRE_ONCE_FILE, "x")
  console.log("Initializing...\n✗ Credential validation failed\n✗ ... TLS handshake timeout")
  process.exit(1)
}
if (mode === "authfail") {
  console.log("Initializing...\n✗ Credential validation failed")
  process.exit(1)
}

trace("start")
console.log(`\x1b[32mfake cre\x1b[0m args: ${args.join(" ")}`)
if (process.env.FAKE_SECRET) console.log(`Using RPC ${process.env.FAKE_SECRET}`)
const ci = args.indexOf("--config")
// Like the real CLI (checked in S1 4.5): --config is resolved from the workflow folder.
if (ci >= 0) console.log(`config: ${readFileSync(join(wf, args[ci + 1]), "utf8").replace(/\s+/g, " ")}`)
const finish = () => {
  trace("end")
  if (mode === "fail") {
    console.error("Error: simulation failed")
    process.exit(1)
  }
  if (mode !== "noresult") console.log(`✓ Workflow Simulation Result:\n"W9 fake: ${wf} trigger ${trig} done"`)
  process.exit(0)
}
if (mode === "slow") setTimeout(finish, Number(process.env.FAKE_CRE_SLEEP_MS ?? 200))
else finish()
