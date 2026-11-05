import { describe, expect, it } from "vitest"
import { atLeast, exitCode, formatRows, runChecks, type Check, type Ctx } from "./core"

const ctx: Ctx = { env: {}, envFileFound: false, versions: { node: "22.18.0", pnpm: "9.15.9" } }

describe("runChecks", () => {
  it("turns a thrown error into a fail row", async () => {
    const boom: Check = {
      id: "boom",
      owner: "shared",
      title: "Boom",
      run: () => {
        throw new Error("kaput")
      },
    }
    const [row] = await runChecks([boom], ctx)
    expect(row).toMatchObject({ id: "boom", status: "fail", detail: "kaput" })
  })
  it("exits 1 only when something fails", () => {
    expect(exitCode([{ status: "ok" }, { status: "warn" }])).toBe(0)
    expect(exitCode([{ status: "ok" }, { status: "fail" }])).toBe(1)
  })
  it("formats one line per row with status, owner and id", () => {
    const out = formatRows([
      { id: "node-version", owner: "shared", title: "Node", status: "ok", detail: "22.18.0" },
      { id: "env-file", owner: "shared", title: ".env", status: "warn", detail: "missing" },
    ])
    const lines = out.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[ok\]\s+shared\s+node-version\s+22\.18\.0$/)
    expect(lines[1]).toMatch(/^\[warn\]/)
  })
})

describe("atLeast", () => {
  it("compares major.minor.patch numerically", () => {
    expect(atLeast("22.18.0", "22.10.0")).toBe(true)
    expect(atLeast("22.10.0", "22.10.0")).toBe(true)
    expect(atLeast("22.9.1", "22.10.0")).toBe(false)
    expect(atLeast("v22.10.0", "22.10.0")).toBe(true)
    expect(atLeast("21.99.0", "22.10.0")).toBe(false)
  })
})
