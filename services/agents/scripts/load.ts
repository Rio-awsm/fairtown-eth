import { mkdirSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { loadMarkdown, runLoad } from "../src/load/loadTest"

// pnpm -F agents load [--minutes 10] [--agents 50]. FakeChain at 200 ms blocks with an in-process relay (no anvil here).
const argv = process.argv.slice(2)
const { values } = parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options: { minutes: { type: "string", default: "10" }, agents: { type: "string", default: "50" } } })
const report = await runLoad({ agents: Number(values.agents), durationMs: Number(values.minutes) * 60_000 })
const dir = new URL("../eval/", import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL("load-report.json", dir), JSON.stringify(report, null, 2))
writeFileSync(new URL("load-report.md", dir), loadMarkdown(report))
console.log(loadMarkdown(report))
process.exit(report.pass ? 0 : 1)
