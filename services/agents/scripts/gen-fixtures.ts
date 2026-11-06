import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderFixtures } from "../src/fixtures/render"

const dir = fileURLToPath(new URL("../../../packages/shared/fixtures/", import.meta.url))
const files = renderFixtures()
for (const [name, body] of Object.entries(files)) writeFileSync(`${dir}${name}`, body)
console.log(`wrote ${Object.keys(files).join(", ")} to ${dir}`)
