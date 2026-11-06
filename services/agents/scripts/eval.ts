import { loadEnv } from "@fairtown/shared/env"
import { mkdirSync, writeFileSync } from "node:fs"
import { formatUnits, parseUnits } from "viem"
import { parseAiConfig, targetFor } from "../src/ai/config"
import { FakeAi } from "../src/ai/fake"
import { createGateway } from "../src/ai/gateway"
import { buildCases, loadFixtureLots, reportMarkdown, runEval } from "../src/eval/bidderEval"
import { PERSONAS } from "../src/fixtures/personas"
import { loadReferences } from "../src/listing/references"

// pnpm -F agents eval [n=200]. Live provider unless MOCK_AI=1. Writes eval/report{,-mock}.{json,md}; exits 1 below thresholds.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
const n = Number(process.argv[2] ?? 200)
const config = parseAiConfig(env)
const ai = createGateway({ config, fake: new FakeAi().on("bidder", fakeBidder) })
const provider = config.MOCK_AI ? "mock (FakeAi)" : `bidder=${targetFor(config, "bidder").model}`

// Each decision can take up to 3 requests; stay well inside the bidder's share of LLM_MAX_RPM.
const paceRpm = !config.MOCK_AI && config.LLM_MAX_RPM ? Math.max(1, Math.floor(config.LLM_MAX_RPM * 0.6)) : undefined
const report = await runEval({
  ai,
  provider,
  cases: buildCases(PERSONAS, loadFixtureLots(), n),
  references: loadReferences(),
  ...(paceRpm ? { paceRpm, onBatch: (d: number) => console.log(`${d}/${n} decided`) } : {}),
})
const dir = new URL("../eval/", import.meta.url)
mkdirSync(dir, { recursive: true })
const name = config.MOCK_AI ? "report-mock" : "report"
writeFileSync(new URL(`${name}.json`, dir), JSON.stringify(report, null, 2))
writeFileSync(new URL(`${name}.md`, dir), reportMarkdown(report))
console.log(reportMarkdown(report).split("\n").slice(0, 14).join("\n"))
console.log(`\nSaved eval/${name}.json and eval/${name}.md`)
process.exit(report.pass ? 0 : 1)

// Deterministic stand-in: bids halfway between clearing and mandate max.
function fakeBidder(i: { prompt: string }) {
  const clearing = parseUnits(i.prompt.match(/clearing ([\d.]+)/)?.[1] ?? "0", 6)
  const max = parseUnits(i.prompt.match(/max [^\d]*([\d.]+)\//)?.[1] ?? "0", 6)
  const mid = formatUnits((clearing + max) / 2n, 6)
  return { action: "bid", maxPerUnit: mid, reason: `Fair at ${mid}, below my ${formatUnits(max, 6)} cap` }
}
