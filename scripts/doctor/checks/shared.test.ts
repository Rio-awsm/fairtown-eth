import { describe, expect, it } from "vitest"
import { formatRows, runChecks, type Ctx } from "../core"
import { sharedChecks } from "./shared"

const base: Ctx = { env: {}, envFileFound: true, versions: { node: "22.18.0", pnpm: "9.15.9" } }
const mock = { CHAIN_MODE: "fake", ARKIV_MODE: "memory", MOCK_AI: "1" }
const rowOf = async (ctx: Ctx, id: string) => (await runChecks(sharedChecks, ctx)).find((r) => r.id === id)!

describe("shared doctor checks", () => {
  it("all ok in full mock mode", async () => {
    const rows = await runChecks(sharedChecks, { ...base, env: mock })
    expect(rows.map((r) => r.status)).toEqual(rows.map(() => "ok"))
  })
  it("fails on old Node", async () => {
    const ctx = { ...base, env: mock, versions: { node: "22.9.0", pnpm: "9.15.9" } }
    expect((await rowOf(ctx, "node-version")).status).toBe("fail")
  })
  it("fails on pnpm 10 or missing pnpm", async () => {
    const v10 = { ...base, env: mock, versions: { node: "22.18.0", pnpm: "10.18.2" } }
    const none = { ...base, env: mock, versions: { node: "22.18.0", pnpm: null } }
    expect((await rowOf(v10, "pnpm-version")).status).toBe("fail")
    expect((await rowOf(none, "pnpm-version")).status).toBe("fail")
  })
  it("warns when .env is missing", async () => {
    expect((await rowOf({ ...base, envFileFound: false, env: mock }, "env-file")).status).toBe("warn")
  })
  it("warns when a mode is unset and fails on an unknown mode value", async () => {
    expect((await rowOf({ ...base, env: { CHAIN_MODE: "fake" } }, "env-modes")).status).toBe("warn")
    expect((await rowOf({ ...base, env: { ...mock, CHAIN_MODE: "mainnet" } }, "env-modes")).status).toBe("fail")
  })
  it("live Arkiv without keys fails and names the missing vars", async () => {
    const row = await rowOf({ ...base, env: { ...mock, ARKIV_MODE: "live" } }, "env-required")
    expect(row.status).toBe("fail")
    expect(row.detail).toContain("ARKIV_ACCESS_KEY")
    expect(row.detail).toContain("ARKIV_PRIVATE_KEY")
  })
  it("base-sepolia requires CHAIN_ID 84532", async () => {
    const env = { ...mock, CHAIN_MODE: "base-sepolia", RPC_URL: "https://sepolia.base.org", CHAIN_ID: "1" }
    expect((await rowOf({ ...base, env }, "env-required")).status).toBe("fail")
    expect((await rowOf({ ...base, env: { ...env, CHAIN_ID: "84532" } }, "env-required")).status).toBe("ok")
  })
  it("treats an empty value as missing", async () => {
    const env = { ...mock, MOCK_AI: "0", LLM_BASE_URL: "" }
    expect((await rowOf({ ...base, env }, "env-required")).status).toBe("fail")
  })
  it("never prints env values", async () => {
    const env = { ...mock, ARKIV_MODE: "live", ARKIV_PRIVATE_KEY: "0xdeadbeefsecret", ARKIV_ACCESS_KEY: "ak_topsecret" }
    const out = formatRows(await runChecks(sharedChecks, { ...base, env }))
    expect(out).not.toContain("deadbeefsecret")
    expect(out).not.toContain("topsecret")
  })
})
