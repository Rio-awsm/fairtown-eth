import { BaseError } from "viem"
import { describe, expect, it } from "vitest"
import {
  ANVIL_RPC,
  addressLink,
  exitHints,
  expectedSettle,
  networkConfig,
  requireKey,
  requireMnemonic,
  safeErrorMessage,
  txLink,
  type CheckpointView,
} from "../src/lib"

const SECRET_URL = "https://base-sepolia.example/v2/SECRET_RPC_KEY"

describe("networkConfig", () => {
  it("anvil defaults to the local fork; base-sepolia uses RPC_URL", () => {
    expect(networkConfig("anvil", {}).rpcUrl).toBe(ANVIL_RPC)
    expect(networkConfig("base-sepolia", { RPC_URL: SECRET_URL }).rpcUrl).toBe(SECRET_URL)
  })
  it("rejects unknown or missing networks", () => {
    expect(() => networkConfig("mainnet", {})).toThrow(/Usage/)
    expect(() => networkConfig(undefined, {})).toThrow(/Usage/)
  })
  it("fails without RPC_URL and never echoes a bad URL", () => {
    expect(() => networkConfig("base-sepolia", {})).toThrow(/RPC_URL is unset/)
    try {
      networkConfig("base-sepolia", { RPC_URL: "wss://x/SECRET_RPC_KEY" })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET_RPC_KEY")
    }
  })
})

describe("keys and mnemonic", () => {
  it("accepts a 0x 32-byte key and names the variable on errors, never the value", () => {
    const key = `0x${"ab".repeat(32)}`
    expect(requireKey({ K: key }, "K")).toBe(key)
    expect(() => requireKey({}, "DEPLOYER_PRIVATE_KEY")).toThrow("DEPLOYER_PRIVATE_KEY is unset")
    try {
      requireKey({ K: "ab".repeat(32) }, "K") // missing 0x, as MetaMask exports it
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toMatch(/0x followed by 64 hex/)
      expect((e as Error).message).not.toContain("abab")
    }
  })
  it("checks mnemonic word count without echoing it", () => {
    const twelve = Array(12).fill("word").join(" ")
    expect(requireMnemonic({ AGENT_MNEMONIC: ` ${twelve} ` })).toBe(twelve)
    expect(() => requireMnemonic({})).toThrow(/unset/)
    try {
      requireMnemonic({ AGENT_MNEMONIC: "secretword secretword" })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).not.toContain("secretword")
    }
  })
})

describe("expectedSettle", () => {
  it("matches the guide example: EUR 5,460 new seller", () => {
    expect(expectedSettle(5_460_000_000n, 100n, 5000n)).toEqual({
      fee: 54_600_000n,
      advance: 2_702_700_000n,
      held: 2_702_700_000n,
    })
  })
})

describe("exitHints", () => {
  // Checkpoint chain (block: clearing): 10:100 <- 12:100 <- 15:150 <- 18:200 <- 20:200 (final)
  const chain: Record<string, CheckpointView> = {
    "10": { block: 10n, clearingPrice: 100n, prev: 0n },
    "12": { block: 12n, clearingPrice: 100n, prev: 10n },
    "15": { block: 15n, clearingPrice: 150n, prev: 12n },
    "18": { block: 18n, clearingPrice: 200n, prev: 15n },
    "20": { block: 20n, clearingPrice: 200n, prev: 18n },
  }
  const get = async (b: bigint) => chain[b.toString()]!

  it("outbid bid: earliest checkpoint above max, latest below max", async () => {
    expect(await exitHints(150n, 20n, get)).toEqual({ lastFullyFilled: 12n, outbid: 18n })
  })
  it("bid at the final clearing price: outbid is 0", async () => {
    expect(await exitHints(200n, 20n, get)).toEqual({ lastFullyFilled: 15n, outbid: 0n })
  })
  it("throws when no checkpoint is below the max price", async () => {
    await expect(exitHints(100n, 20n, get)).rejects.toThrow(/No fully filled checkpoint/)
  })
})

describe("links", () => {
  it("builds explorer links without double slashes", () => {
    expect(txLink("https://sepolia.basescan.org/", "0xab")).toBe("https://sepolia.basescan.org/tx/0xab")
    expect(addressLink("https://sepolia.basescan.org", "0xcd")).toBe("https://sepolia.basescan.org/address/0xcd")
  })
})

describe("safeErrorMessage", () => {
  it("drops viem's URL-bearing message and redacts what remains", () => {
    const e = new BaseError("Transaction creation failed.", { details: `insufficient funds at ${SECRET_URL}` })
    expect(e.message).toContain("SECRET_RPC_KEY") // viem's full message would leak it
    const msg = safeErrorMessage(e, [SECRET_URL])
    expect(msg).toContain("Transaction creation failed.")
    expect(msg).not.toContain("SECRET_RPC_KEY")
  })
  it("redacts plain errors and ignores empty secrets", () => {
    expect(safeErrorMessage(new Error(`boom ${SECRET_URL}`), [undefined, SECRET_URL])).toBe("boom <RPC_URL>")
    expect(safeErrorMessage("plain", [""])).toBe("plain")
  })
})
