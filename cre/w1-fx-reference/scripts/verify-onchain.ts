/**
 * Proves a W1 broadcast landed (S1 4.2, D-69): `bun scripts/verify-onchain.ts <log>...` reads each value line with a tx
 * hash from saved `cre workflow simulate --broadcast` logs, checks the receipt for the matching SignalOracle event,
 * then prints what the SignalOracle stores now. Exit 1 if any value did not land. RPC: RPC_URL, else the public
 * Base Sepolia endpoint. Prints no URL and no key.
 */
import { createPublicClient, http, parseAbi, stringToHex, type Hex } from "viem"
import config from "../config.json"
import { checkReceipt, parseBroadcastLog } from "../src/verify"

const rpc = process.env.RPC_URL || "https://sepolia.base.org"
const pub = createPublicClient({ transport: http(rpc, { retryCount: 2, timeout: 15_000 }) })
const oracle = config.signalOracle as Hex
const VIEWS = parseAbi([
  "function fxRate(bytes32) view returns (uint256 perUsdE8, uint64 updatedAt)",
  "function referencePrice(bytes32, bytes32) view returns (uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 updatedAt)",
])
const k = (s: string) => stringToHex(s, { size: 32 })

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: bun scripts/verify-onchain.ts <broadcast log>...")
  process.exit(2)
}
const expected = (await Promise.all(files.map((f) => Bun.file(f).text()))).flatMap(parseBroadcastLog)
if (expected.length === 0) {
  console.error("no value lines with tx hashes in the given logs")
  process.exit(1)
}
let bad = 0
for (const e of expected) {
  const label = e.kind === "fx" ? `fx ${e.quote}` : `ref ${e.commodity}@${e.market}`
  try {
    const r = await pub.getTransactionReceipt({ hash: e.txHash })
    const problem = r.status !== "success" ? `tx ${r.status}` : checkReceipt(e, r.logs, oracle)
    if (problem) bad++
    console.log(
      `${problem ? "FAIL" : "ok  "} ${label.padEnd(28)} ${e.txHash} ${problem ?? `event in block ${r.blockNumber}`}`,
    )
  } catch (err) {
    bad++
    console.log(
      `FAIL ${label.padEnd(28)} ${e.txHash} ${(err as { shortMessage?: string }).shortMessage ?? "receipt read failed"}`,
    )
  }
}
console.log("\nSignalOracle now:")
for (const q of config.fxQuotes) {
  const [rate, at] = await pub.readContract({ address: oracle, abi: VIEWS, functionName: "fxRate", args: [k(q)] })
  console.log(`  fxRate(${q}) = ${rate} perUsdE8, updatedAt ${at}`)
}
for (const p of config.pairs) {
  const [perUnit, , , at] = await pub.readContract({
    address: oracle,
    abi: VIEWS,
    functionName: "referencePrice",
    args: [k(p.commodity), k(p.market)],
  })
  console.log(`  referencePrice(${p.commodity}, ${p.market}) = ${perUnit}, updatedAt ${at}`)
}
console.log(`\n${expected.length - bad} of ${expected.length} broadcast values landed`)
process.exit(bad === 0 ? 0 : 1)
