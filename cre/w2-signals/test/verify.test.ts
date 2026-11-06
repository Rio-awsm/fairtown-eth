import { describe, expect, test } from "bun:test"
import { encodeAbiParameters, encodeEventTopics, stringToHex, type Hex, type Log } from "viem"
import { DEMAND_SIGNAL, checkReceipt, parseBroadcastLog } from "../src/verify"

const ORACLE = "0x8B0eE1395ee575D234ae5dDE927062B646A685B2"
const FWD = "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5"
const H1 = `0x${"a1".repeat(32)}` as Hex
const H2 = `0x${"b2".repeat(32)}` as Hex
const k = (s: string) => stringToHex(s, { size: 32 })

const LOG = [
  "[USER LOG] W2 calendar: 2 within 7 days of 2026-11-06, 1 forced",
  `[USER LOG] W2 signal festival mumbai sev 4 "Diwali in 2 days" expires block 55900000 (2026-11-09T00:00:00.000Z), source Diwali (Lakshmi Puja) 2026-11-08 https://www.timeanddate.com/holidays/india/diwali: written ${H1}`,
  `[USER LOG] W2 signal festival nairobi sev 4 "Valentine's cargo cutoff (forced)" expires block 55250000 (2026-11-06T13:55:00.000Z) FORCED, source config forceSignals (demo): written ${H2}`,
  "[USER LOG] W2 weather bergen: calm, no signal",
].join("\n")

const ev = (kind: string, place: string, severity: number, expires: bigint, label: string, address = ORACLE) =>
  ({
    address,
    topics: encodeEventTopics({
      abi: DEMAND_SIGNAL,
      eventName: "DemandSignal",
      args: { id: 1n, signalKind: k(kind), place: k(place) },
    }),
    data: encodeAbiParameters([{ type: "uint8" }, { type: "uint64" }, { type: "string" }], [severity, expires, label]),
  }) as unknown as Log

describe("parseBroadcastLog", () => {
  test("reads signal lines with tx hashes, including FORCED", () => {
    expect(parseBroadcastLog(LOG)).toEqual([
      {
        kind: "festival",
        place: "mumbai",
        severity: 4,
        label: "Diwali in 2 days",
        expiresAtBlock: 55_900_000n,
        forced: false,
        txHash: H1,
      },
      {
        kind: "festival",
        place: "nairobi",
        severity: 4,
        label: "Valentine's cargo cutoff (forced)",
        expiresAtBlock: 55_250_000n,
        forced: true,
        txHash: H2,
      },
    ])
  })
})

describe("checkReceipt", () => {
  const [diwali, valentine] = parseBroadcastLog(LOG) as [
    ReturnType<typeof parseBroadcastLog>[number],
    ReturnType<typeof parseBroadcastLog>[number],
  ]
  test("accepts the matching DemandSignal", () => {
    expect(checkReceipt(diwali, [ev("festival", "mumbai", 4, 55_900_000n, "Diwali in 2 days")], ORACLE)).toBeNull()
    expect(
      checkReceipt(valentine, [ev("festival", "nairobi", 4, 55_250_000n, "Valentine's cargo cutoff (forced)")], ORACLE),
    ).toBeNull()
  })
  test("rejects a swallowed revert and any field that differs", () => {
    expect(
      checkReceipt(diwali, [{ address: FWD, topics: [`0x${"36".repeat(32)}`], data: "0x" } as unknown as Log], ORACLE),
    ).toContain("no SignalOracle event")
    expect(checkReceipt(diwali, [ev("festival", "pune", 4, 55_900_000n, "Diwali in 2 days")], ORACLE)).toContain("pune")
    expect(checkReceipt(diwali, [ev("festival", "mumbai", 3, 55_900_000n, "Diwali in 2 days")], ORACLE)).toContain(
      "severity 3",
    )
    expect(checkReceipt(diwali, [ev("festival", "mumbai", 4, 1n, "Diwali in 2 days")], ORACLE)).toContain(
      "expiresAtBlock 1",
    )
    expect(checkReceipt(diwali, [ev("festival", "mumbai", 4, 55_900_000n, "Diwali soon")], ORACLE)).toContain("label")
    expect(
      checkReceipt(
        { ...valentine, label: "Valentine's cargo cutoff" },
        [ev("festival", "nairobi", 4, 55_250_000n, "Valentine's cargo cutoff")],
        ORACLE,
      ),
    ).toContain("without the (forced) label")
  })
})
