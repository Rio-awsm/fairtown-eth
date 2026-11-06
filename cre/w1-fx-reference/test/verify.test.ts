import { describe, expect, test } from "bun:test"
import { encodeAbiParameters, encodeEventTopics, stringToHex, type Hex, type Log } from "viem"
import { SIGNAL_ORACLE_EVENTS, checkReceipt, parseBroadcastLog } from "../src/verify"

const ORACLE = "0x8B0eE1395ee575D234ae5dDE927062B646A685B2"
const FWD = "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5"
const H1 = `0x${"c2".repeat(32)}` as Hex
const H2 = `0x${"0f".repeat(32)}` as Hex
const k = (s: string) => stringToHex(s, { size: 32 })

// Lines as the simulator prints them (S1 4.2 broadcast, 2026-11-06).
const LOG = [
  "2026-11-06T13:27:41Z [USER LOG] W1 fx: source https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR dates [EUR=2026-11-06] asOf 1793951861",
  `2026-11-06T13:27:44Z [USER LOG] W1 fx EUR = 0.88915000 per USD (perUsdE8 88915000): written ${H1}`,
  `2026-11-06T13:28:01Z [USER LOG] W1 ref cod@bergen = 8300000 EUR base units, dated 2026-11-05, source "illustrative: scene value" https://www.rafisklaget.no/minstepriser: written ${H2}`,
  "2026-11-06T13:28:02Z [USER LOG] W1 ref tomato@lagos: skipped (HTTP 404)",
  "2026-11-06T13:28:03Z [USER LOG] W1 fx NOK: no consensus value, not written",
].join("\n")

const fxLog = (code: string, rate: bigint, address = ORACLE): Log =>
  ({
    address,
    topics: encodeEventTopics({ abi: SIGNAL_ORACLE_EVENTS, eventName: "FxUpdated", args: { currencyCode: k(code) } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }], [rate, 1n]),
  }) as unknown as Log
const refLog = (c: string, m: string, perUnit: bigint, cur: string): Log =>
  ({
    address: ORACLE,
    topics: encodeEventTopics({
      abi: SIGNAL_ORACLE_EVENTS,
      eventName: "ReferencePriceUpdated",
      args: { commodity: k(c), market: k(m) },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
      [perUnit, k(cur), k("api:2026-11-05"), 1n],
    ),
  }) as unknown as Log

describe("parseBroadcastLog", () => {
  test("takes value lines with a tx hash and ignores the rest", () => {
    expect(parseBroadcastLog(LOG)).toEqual([
      { kind: "fx", quote: "EUR", perUsdE8: 88_915_000n, txHash: H1 },
      { kind: "ref", commodity: "cod", market: "bergen", perUnit: 8_300_000n, currency: "EUR", txHash: H2 },
    ])
    expect(parseBroadcastLog("dry run: W1 fx EUR = 0.889 per USD (perUsdE8 88900000): written")).toEqual([])
  })
})

describe("checkReceipt", () => {
  const [fx, ref] = parseBroadcastLog(LOG) as [
    ReturnType<typeof parseBroadcastLog>[number],
    ReturnType<typeof parseBroadcastLog>[number],
  ]
  test("accepts the matching SignalOracle event", () => {
    expect(checkReceipt(fx, [fxLog("EUR", 88_915_000n)], ORACLE)).toBeNull()
    expect(checkReceipt(ref, [refLog("cod", "bergen", 8_300_000n, "EUR")], ORACLE)).toBeNull()
  })
  test("the first broadcast's failure: only the forwarder's log, no oracle event", () => {
    const forwarderOnly = { address: FWD, topics: [`0x${"36".repeat(32)}`], data: "0x" } as unknown as Log
    expect(checkReceipt(fx, [forwarderOnly], ORACLE)).toContain("no SignalOracle event")
  })
  test("rejects wrong values, wrong keys and the wrong event", () => {
    expect(checkReceipt(fx, [fxLog("EUR", 1n)], ORACLE)).toContain("expected 88915000")
    expect(checkReceipt(fx, [fxLog("NOK", 88_915_000n)], ORACLE)).toContain("is for NOK")
    expect(checkReceipt(fx, [fxLog("EUR", 88_915_000n, FWD)], ORACLE)).toContain("no SignalOracle event")
    expect(checkReceipt(fx, [refLog("cod", "bergen", 8_300_000n, "EUR")], ORACLE)).toBe("no FxUpdated event")
    expect(checkReceipt(ref, [refLog("cod", "oslo", 8_300_000n, "EUR")], ORACLE)).toContain("is for cod@oslo")
    expect(checkReceipt(ref, [refLog("cod", "bergen", 8_300_001n, "EUR")], ORACLE)).toContain("expected 8300000")
    expect(checkReceipt(ref, [refLog("cod", "bergen", 8_300_000n, "USD")], ORACLE)).toContain("expected EUR")
    expect(checkReceipt(ref, [fxLog("EUR", 1n)], ORACLE)).toBe("no ReferencePriceUpdated event")
  })
})
