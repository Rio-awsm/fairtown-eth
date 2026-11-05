import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { s1Checks } from "./doctor/checks/s1"
import { sharedChecks } from "./doctor/checks/shared"
import { exitCode, formatRows, runChecks, type Check } from "./doctor/core"
import { loadEnv } from "./doctor/env"

const checks: Check[] = [...sharedChecks, ...s1Checks]

const root = fileURLToPath(new URL("../", import.meta.url))
const { env, found } = loadEnv(`${root}.env`)
const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", cwd: root })
const rows = await runChecks(checks, {
  env,
  envFileFound: found,
  versions: { node: process.versions.node, pnpm: pnpm.status === 0 ? pnpm.stdout.trim() : null },
})
console.log(formatRows(rows))
process.exitCode = exitCode(rows)
