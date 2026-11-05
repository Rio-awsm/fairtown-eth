import { parseEther, type Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { formatRows, runChecks, type Ctx, type Env } from "../core"
import { addressOf, makeS1Checks, parseVersion, rpcUrlFor, type Exec, type Rpc, type S1Deps } from "./s1"

// Fresh random keys per run: no key material is stored in the repo (CLAUDE.md).
const KEY_0 = generatePrivateKey()
const ADDR_0 = privateKeyToAccount(KEY_0).address
const KEY_1 = generatePrivateKey()

const tools: Record<string, string> = {
  forge: "forge Version: 1.9.0-stable\nCommit SHA: 6056c58",
  anvil: "anvil Version: 1.9.0-stable",
  bun: "1.4.4",
}

function fakeExec(over: Partial<Record<string, string | null>> = {}, ccaTag: string | null = "v2.1.0"): Exec {
  return (cmd) => {
    if (cmd === "git") return ccaTag === null ? { ok: false, stdout: "" } : { ok: true, stdout: ccaTag }
    const out = cmd in over ? over[cmd] : tools[cmd]
    return out == null ? { ok: false, stdout: "" } : { ok: true, stdout: out }
  }
}

function fakeRpc(opts: { chainId?: number; balances?: Record<string, bigint>; fail?: Error } = {}): S1Deps["rpc"] {
  return (): Rpc => ({
    chainId: async () => {
      if (opts.fail) throw opts.fail
      return opts.chainId ?? 84532
    },
    balance: async (a: Address) => {
      if (opts.fail) throw opts.fail
      return opts.balances?.[a.toLowerCase()] ?? parseEther("1")
    },
  })
}

const deps = (o: Partial<S1Deps> = {}): S1Deps => ({ root: "/repo/", exec: fakeExec(), rpc: fakeRpc(), ...o })
const liveEnv: Env = {
  CHAIN_MODE: "base-sepolia",
  RPC_URL: "https://base-sepolia.example/v2/SECRET_RPC_KEY",
  DEPLOYER_PRIVATE_KEY: KEY_0,
  KEEPER_PRIVATE_KEY: KEY_1,
}
const ctx = (env: Env): Ctx => ({ env, envFileFound: true, versions: { node: "22.18.0", pnpm: "9.15.9" } })
const row = async (d: S1Deps, env: Env, id: string) =>
  (await runChecks(makeS1Checks(d), ctx(env))).find((r) => r.id === id)!

describe("S1 doctor checks", () => {
  it("all ok with tools, CCA pin, chain 84532 and funded wallets", async () => {
    const rows = await runChecks(makeS1Checks(deps()), ctx(liveEnv))
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["forge-version", "ok"],
      ["anvil-version", "ok"],
      ["bun-version", "ok"],
      ["cca-pin", "ok"],
      ["rpc-chain", "ok"],
      ["wallet-balances", "ok"],
    ])
  })

  it("parses tool versions from banners", () => {
    expect(parseVersion(tools.forge!)).toBe("1.9.0")
    expect(parseVersion("1.4.4")).toBe("1.4.4")
    expect(parseVersion("garbage")).toBeNull()
  })

  it("fails when forge or bun is missing", async () => {
    expect((await row(deps({ exec: fakeExec({ forge: null }) }), liveEnv, "forge-version")).status).toBe("fail")
    expect((await row(deps({ exec: fakeExec({ bun: null }) }), liveEnv, "bun-version")).status).toBe("fail")
  })

  it("fails on Foundry 0.x and old Bun", async () => {
    expect((await row(deps({ exec: fakeExec({ forge: "forge 0.3.0" }) }), liveEnv, "forge-version")).status).toBe(
      "fail",
    )
    expect((await row(deps({ exec: fakeExec({ bun: "1.1.9" }) }), liveEnv, "bun-version")).status).toBe("fail")
  })

  it("fails when CCA is on another tag or no tag", async () => {
    const other = await row(deps({ exec: fakeExec({}, "v1.0.0") }), liveEnv, "cca-pin")
    expect(other.status).toBe("fail")
    expect(other.detail).toContain("v2.1.0")
    expect((await row(deps({ exec: fakeExec({}, null) }), liveEnv, "cca-pin")).status).toBe("fail")
  })

  it("fails on the wrong chain", async () => {
    const r = await row(deps({ rpc: fakeRpc({ chainId: 1 }) }), liveEnv, "rpc-chain")
    expect(r.status).toBe("fail")
    expect(r.detail).toContain("84532")
  })

  it("fails on an unreachable RPC without leaking the URL", async () => {
    const err = new Error(`HTTP request failed. URL: ${liveEnv.RPC_URL}`)
    const d = deps({ rpc: fakeRpc({ fail: err }) })
    const rows = await runChecks(makeS1Checks(d), ctx(liveEnv))
    expect(rows.find((r) => r.id === "rpc-chain")!.status).toBe("fail")
    expect(rows.find((r) => r.id === "wallet-balances")!.status).toBe("fail")
    expect(formatRows(rows)).not.toContain("SECRET_RPC_KEY")
  })

  it("skips chain rows as warn in fake mode", async () => {
    const env = { CHAIN_MODE: "fake" }
    expect((await row(deps(), env, "rpc-chain")).status).toBe("warn")
    expect((await row(deps(), env, "wallet-balances")).status).toBe("warn")
  })

  it("anvil mode uses FORK_RPC_URL and fails without it", async () => {
    expect(rpcUrlFor({ CHAIN_MODE: "anvil", FORK_RPC_URL: "http://x", RPC_URL: "http://y" })).toBe("http://x")
    expect((await row(deps(), { CHAIN_MODE: "anvil" }, "rpc-chain")).status).toBe("fail")
  })

  it("fails when a key is unset or malformed", async () => {
    const unset = await row(deps(), { ...liveEnv, KEEPER_PRIVATE_KEY: "" }, "wallet-balances")
    expect(unset.status).toBe("fail")
    expect(unset.detail).toContain("KEEPER_PRIVATE_KEY unset")
    const bad = await row(deps(), { ...liveEnv, DEPLOYER_PRIVATE_KEY: "0x1234" }, "wallet-balances")
    expect(bad.status).toBe("fail")
  })

  it("warns below the minimum and fails on an empty wallet", async () => {
    const low = { [ADDR_0.toLowerCase()]: parseEther("0.05") }
    expect((await row(deps({ rpc: fakeRpc({ balances: low }) }), liveEnv, "wallet-balances")).status).toBe("warn")
    const empty = { [ADDR_0.toLowerCase()]: 0n }
    expect((await row(deps({ rpc: fakeRpc({ balances: empty }) }), liveEnv, "wallet-balances")).status).toBe("fail")
  })

  it("prints addresses, never private keys or the RPC URL", async () => {
    const out = formatRows(await runChecks(makeS1Checks(deps()), ctx(liveEnv)))
    expect(out).toContain(ADDR_0)
    expect(out).not.toContain(KEY_0.slice(2))
    expect(out).not.toContain(KEY_1.slice(2))
    expect(out).not.toContain("SECRET_RPC_KEY")
    const bad = formatRows(
      await runChecks(makeS1Checks(deps()), ctx({ ...liveEnv, KEEPER_PRIVATE_KEY: "0xnotakey-secretish" })),
    )
    expect(bad).not.toContain("secretish")
  })

  it("addressOf derives the address and rejects junk", () => {
    expect(addressOf(KEY_0)).toEqual({ address: ADDR_0 })
    expect(addressOf(undefined)).toEqual({ error: "unset" })
    expect("error" in addressOf(`0x${"0".repeat(64)}`)).toBe(true)
  })
})
