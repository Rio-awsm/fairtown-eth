import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const src = fileURLToPath(new URL("..", import.meta.url))
const filesIn = (dir: string) =>
  readdirSync(src + dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .map((f) => `${dir}/${f}`)

// Golden rule 3 and the 0.1 key rule: scene logic is a pure reducer that imports no renderer
// (three.js since D-113; Phaser before it).
const PURE = [
  "game/reducer.ts",
  "game/commands.ts",
  "game/EventBus.ts",
  "money/format.ts",
  ...filesIn("game/map"),
  ...filesIn("net"),
  ...filesIn("state"),
]

const RENDERER = /from\s+["'](phaser|three)(\/[^"']*)?["']|import\(\s*["'](phaser|three)(\/[^"']*)?["']\s*\)/

describe("pure modules", () => {
  it.each(PURE)("%s imports no renderer", (file) => {
    expect(readFileSync(src + file, "utf8")).not.toMatch(RENDERER)
  })

  it("the check catches a renderer import", () => {
    expect('import * as THREE from "three"').toMatch(RENDERER)
    expect('import { X } from "three/addons/x.js"').toMatch(RENDERER)
    expect('await import("phaser")').toMatch(RENDERER)
    expect('import { threeWay } from "./threeWay"').not.toMatch(RENDERER)
  })
})
