import { writeFileSync } from "node:fs"
import { recordDay } from "../src/load/record"

// pnpm -F agents record. Plays full_day on FakeChain and writes packages/shared/fixtures/day.recorded.jsonl (ICR-007).
const r = await recordDay()
const file = new URL("../../../packages/shared/fixtures/day.recorded.jsonl", import.meta.url)
writeFileSync(file, r.envelopes.map((e) => JSON.stringify(e)).join("\n") + "\n")
console.log(`Recorded ${r.envelopes.length} envelopes over ${r.blocks} blocks.`)
console.log("Scene lots:", r.lots)
console.log("Events:", r.counts)
