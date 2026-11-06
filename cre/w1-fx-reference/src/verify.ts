/**
 * Pure helpers for scripts/verify-onchain.ts (S1 4.2, D-69): the CRE simulator's reply is not proof that the receiver
 * accepted a report (the forwarder swallows receiver reverts, and a missing receiver status reads as success). So
 * every broadcast is checked against the chain: the receipt must carry the SignalOracle event with the same values.
 */
import { parseAbi, parseEventLogs, hexToString, type Hex, type Log } from "viem"

export const SIGNAL_ORACLE_EVENTS = parseAbi([
  "event FxUpdated(bytes32 indexed currencyCode, uint256 perUsdE8, uint64 updatedAt)",
  "event ReferencePriceUpdated(bytes32 indexed commodity, bytes32 indexed market, uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 updatedAt)",
])

export type Expected =
  | { kind: "fx"; quote: string; perUsdE8: bigint; txHash: Hex }
  | { kind: "ref"; commodity: string; market: string; perUnit: bigint; currency: string; txHash: Hex }

const FX_LINE = /W1 fx ([A-Z]{3,4}) = [\d.]+ per USD \(perUsdE8 (\d+)\): .*?(0x[0-9a-f]{64})/
const REF_LINE = /W1 ref ([a-z0-9_]+)@([a-z0-9_]+) = (\d+) ([A-Z]{3,4}) base units, .*?(0x[0-9a-f]{64})\s*$/

/** Every value line that carries a tx hash, from a saved `cre workflow simulate --broadcast` log. */
export function parseBroadcastLog(text: string): Expected[] {
  const out: Expected[] = []
  for (const line of text.split("\n")) {
    const fx = FX_LINE.exec(line)
    if (fx) {
      out.push({ kind: "fx", quote: fx[1]!, perUsdE8: BigInt(fx[2]!), txHash: fx[3] as Hex })
      continue
    }
    const ref = REF_LINE.exec(line)
    if (ref) {
      out.push({
        kind: "ref",
        commodity: ref[1]!,
        market: ref[2]!,
        perUnit: BigInt(ref[3]!),
        currency: ref[4]!,
        txHash: ref[5] as Hex,
      })
    }
  }
  return out
}

const b32 = (h: Hex) => hexToString(h, { size: 32 })

/** Does this receipt's log set prove the expected value reached the SignalOracle? Returns null when yes. */
export function checkReceipt(e: Expected, logs: Log[], oracle: string): string | null {
  const own = logs.filter((l) => l.address.toLowerCase() === oracle.toLowerCase())
  if (own.length === 0) return "no SignalOracle event (the receiver call reverted inside the forwarder)"
  const events = parseEventLogs({ abi: SIGNAL_ORACLE_EVENTS, logs: own })
  if (e.kind === "fx") {
    const ev = events.find((x) => x.eventName === "FxUpdated")
    if (!ev || ev.eventName !== "FxUpdated") return "no FxUpdated event"
    if (b32(ev.args.currencyCode) !== e.quote) return `FxUpdated is for ${b32(ev.args.currencyCode)}`
    if (ev.args.perUsdE8 !== e.perUsdE8) return `FxUpdated perUsdE8 ${ev.args.perUsdE8}, expected ${e.perUsdE8}`
    return null
  }
  const ev = events.find((x) => x.eventName === "ReferencePriceUpdated")
  if (!ev || ev.eventName !== "ReferencePriceUpdated") return "no ReferencePriceUpdated event"
  const got = `${b32(ev.args.commodity)}@${b32(ev.args.market)}`
  if (got !== `${e.commodity}@${e.market}`) return `ReferencePriceUpdated is for ${got}`
  if (ev.args.perUnit !== e.perUnit) return `perUnit ${ev.args.perUnit}, expected ${e.perUnit}`
  if (b32(ev.args.currencyCode) !== e.currency) return `currency ${b32(ev.args.currencyCode)}, expected ${e.currency}`
  return null
}
