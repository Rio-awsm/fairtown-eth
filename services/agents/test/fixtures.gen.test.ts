import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { renderFixtures } from "../src/fixtures/render"

const dir = new URL("../../../packages/shared/fixtures/", import.meta.url)

describe("fixture generator", () => {
  it("is deterministic and matches the checked-in files", () => {
    const a = renderFixtures()
    const b = renderFixtures()
    expect(a).toEqual(b)
    for (const [name, body] of Object.entries(a)) expect(readFileSync(new URL(name, dir), "utf8")).toBe(body)
  })
})
