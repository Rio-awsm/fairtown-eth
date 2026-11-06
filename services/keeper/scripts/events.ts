/**
 * Read-only event history of one lot from MarketSettlement, in RPC-safe windows:
 *   pnpm -F keeper events base-sepolia <lotId> <fromBlock> [toBlock]
 * Prints each event with block, sender and explorer link. Sends nothing. Never prints the RPC URL.
 */
import { fileURLToPath } from "node:url"
import { BaseError, createPublicClient, http, parseEventLogs, type Address } from "viem"
import { marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { loadEnv, networkConfig, safeErrorMessage, shrinkLogChunk, txLink } from "../src/lib"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const secrets = [env.RPC_URL, env.FORK_RPC_URL, env.ANVIL_RPC_URL]
try {
  const cfg = networkConfig(process.argv[2], env)
  const dep = await loadDeployment(cfg.network)
  const pub = createPublicClient({ transport: http(cfg.rpcUrl, { timeout: 30_000, retryCount: 3 }) })
  const lotId = BigInt(process.argv[3] ?? "")
  let from = BigInt(process.argv[4] ?? "")
  const to = process.argv[5] ? BigInt(process.argv[5]) : await pub.getBlockNumber()
  let win = 200n
  while (from <= to) {
    const end = from + win - 1n < to ? from + win - 1n : to
    try {
      const logs = await pub.getLogs({
        address: dep.contracts.MarketSettlement as Address,
        fromBlock: from,
        toBlock: end,
      })
      for (const ev of parseEventLogs({ abi: marketSettlementAbi, logs })) {
        const a = ev.args as Record<string, unknown>
        if (a.lotId !== lotId && !(ev.eventName === "SellerRecordUpdated")) continue
        if (ev.eventName === "SellerRecordUpdated") continue
        const tx = await pub.getTransaction({ hash: ev.transactionHash })
        const args = Object.entries(a)
          .filter(([k]) => k !== "lotId")
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" ")
        console.log(
          `${ev.blockNumber} ${ev.eventName} ${args} | from ${tx.from} | ${txLink(cfg.explorer, ev.transactionHash)}`,
        )
      }
      from = end + 1n
    } catch (e) {
      const next = shrinkLogChunk(e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : String(e), win, 10n)
      if (next === undefined) throw e
      win = next
    }
  }
} catch (e) {
  console.error(`EVENTS FAILED: ${safeErrorMessage(e, secrets)}`)
  process.exit(1)
}
