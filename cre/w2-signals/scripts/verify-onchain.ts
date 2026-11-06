/**
 * Proves a W2 broadcast landed (S1 4.3): `bun scripts/verify-onchain.ts <log>...` checks every signal line with a tx
 * hash against its receipt's DemandSignal. Exit 1 if any did not land. RPC: RPC_URL, else the public Base Sepolia
 * endpoint. Prints no URL and no key.
 */
import { createPublicClient, http, parseAbi, type Hex } from "viem"
import config from "../config.json"
import { checkReceipt, parseBroadcastLog } from "../src/verify"

const pub = createPublicClient({
  transport: http(process.env.RPC_URL || "https://sepolia.base.org", { retryCount: 2, timeout: 15_000 }),
})
const oracle = config.signalOracle as Hex
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: bun scripts/verify-onchain.ts <broadcast log>...")
  process.exit(2)
}
const expected = (await Promise.all(files.map((f) => Bun.file(f).text()))).flatMap(parseBroadcastLog)
if (expected.length === 0) {
  console.error("no signal lines with tx hashes in the given logs")
  process.exit(1)
}
let bad = 0
for (const e of expected) {
  const label = `${e.kind} ${e.place} sev ${e.severity}${e.forced ? " FORCED" : ""}`
  try {
    const r = await pub.getTransactionReceipt({ hash: e.txHash })
    const problem = r.status !== "success" ? `tx ${r.status}` : checkReceipt(e, r.logs, oracle)
    if (problem) bad++
    console.log(
      `${problem ? "FAIL" : "ok  "} ${label.padEnd(34)} "${e.label}" ${e.txHash} ${problem ?? `block ${r.blockNumber}`}`,
    )
  } catch (err) {
    bad++
    console.log(
      `FAIL ${label.padEnd(34)} ${e.txHash} ${(err as { shortMessage?: string }).shortMessage ?? "receipt read failed"}`,
    )
  }
}
const count = await pub.readContract({
  address: oracle,
  abi: parseAbi(["function signalCount() view returns (uint256)"]),
  functionName: "signalCount",
})
console.log(`\nSignalOracle.signalCount = ${count}`)
console.log(`${expected.length - bad} of ${expected.length} broadcast signals landed`)
process.exit(bad === 0 ? 0 : 1)
