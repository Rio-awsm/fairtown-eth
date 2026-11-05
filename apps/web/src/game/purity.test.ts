import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const src = fileURLToPath(new URL("..", import.meta.url))
const filesIn = (dir: string) =>
  readdirSync(src + dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .map((f) => `${dir}/${f}`)

// Golden rule 3 and the 0.1 key rule: scene logic is a pure reducer with no Phaser imports.
const PURE = [
  "game/reducer.ts",
  "game/commands.ts",
  "game/EventBus.ts",
  "money/format.ts",
  ...filesIn("net"),
  ...filesIn("state"),
]

describe("pure modules", () => {
  it.each(PURE)("%s does not import phaser", (file) => {
    expect(readFileSync(src + file, "utf8")).not.toMatch(/from\s+["']phaser["']|import\(\s*["']phaser["']\s*\)/)
  })
})
