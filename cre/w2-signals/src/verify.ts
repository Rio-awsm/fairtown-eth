/**
 * Pure helpers for scripts/verify-onchain.ts (S1 4.3): every broadcast signal must show up as a SignalOracle
 * `DemandSignal` with the same kind, place, severity, expiry block and label (the simulator's reply is not proof, D-69).
 */
import { hexToString, parseAbi, parseEventLogs, type Hex, type Log } from "viem"

export const DEMAND_SIGNAL = parseAbi([
  "event DemandSignal(uint256 indexed id, bytes32 indexed signalKind, bytes32 indexed place, uint8 severity, uint64 expiresAtBlock, string label)",
])

export type ExpectedSignal = {
  kind: string
  place: string
  severity: number
  label: string
  expiresAtBlock: bigint
  forced: boolean
  txHash: Hex
}

const LINE =
  /W2 signal ([a-z_]+) ([a-z0-9_]+) sev (\d) "([^"]+)" expires block (\d+) \([^)]*\)( FORCED)?, source .*?(0x[0-9a-f]{64})\s*$/

export function parseBroadcastLog(text: string): ExpectedSignal[] {
  const out: ExpectedSignal[] = []
  for (const line of text.split("\n")) {
    const m = LINE.exec(line)
    if (!m) continue
    out.push({
      kind: m[1]!,
      place: m[2]!,
      severity: Number(m[3]),
      label: m[4]!,
      expiresAtBlock: BigInt(m[5]!),
      forced: m[6] !== undefined,
      txHash: m[7] as Hex,
    })
  }
  return out
}

const b32 = (h: Hex) => hexToString(h, { size: 32 })

/** null when the receipt proves the signal; otherwise what is wrong. */
export function checkReceipt(e: ExpectedSignal, logs: Log[], oracle: string): string | null {
  const own = logs.filter((l) => l.address.toLowerCase() === oracle.toLowerCase())
  if (own.length === 0) return "no SignalOracle event (the receiver call reverted inside the forwarder)"
  const ev = parseEventLogs({ abi: DEMAND_SIGNAL, logs: own })[0]
  if (!ev) return "no DemandSignal event"
  const a = ev.args
  if (b32(a.signalKind) !== e.kind || b32(a.place) !== e.place)
    return `DemandSignal is for ${b32(a.signalKind)} ${b32(a.place)}`
  if (a.severity !== e.severity) return `severity ${a.severity}, expected ${e.severity}`
  if (a.expiresAtBlock !== e.expiresAtBlock) return `expiresAtBlock ${a.expiresAtBlock}, expected ${e.expiresAtBlock}`
  if (a.label !== e.label) return `label "${a.label}", expected "${e.label}"`
  if (e.forced && !a.label.endsWith(" (forced)")) return "forced signal without the (forced) label"
  return null
}
