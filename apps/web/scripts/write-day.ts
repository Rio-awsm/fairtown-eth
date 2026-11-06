import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { buildDay, serializeDay } from "../src/mocks/day/build-day"

const target = fileURLToPath(new URL("../src/mocks/day.jsonl", import.meta.url))
const day = buildDay()
writeFileSync(target, serializeDay(day))
console.log(`wrote ${day.length} envelopes to ${target}`)
