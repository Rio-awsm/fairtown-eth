/**
 * Read-only lot status, for following a live keeper run: pnpm -F keeper status base-sepolia <lotId...>
 * Prints settle, exits and claims, carrier, held money and status per lot. Sends nothing. Never prints the RPC URL.
 */
import { fileURLToPath } from "node:url"
import { createPublicClient, http, type Address } from "viem"
import { continuousClearingAuctionAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { LOT_STATUS } from "@fairtown/shared/keys"
import { loadEnv, networkConfig, safeErrorMessage } from "../src/lib"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const secrets = [env.RPC_URL, env.FORK_RPC_URL, env.ANVIL_RPC_URL]
try {
  const cfg = networkConfig(process.argv[2], env)
  const dep = await loadDeployment(cfg.network)
  const pub = createPublicClient({ transport: http(cfg.rpcUrl, { timeout: 30_000, retryCount: 3 }) })
  const ms = { address: dep.contracts.MarketSettlement as Address, abi: marketSettlementAbi } as const
  const head = await pub.getBlockNumber()
  const count = await pub.readContract({
    address: dep.contracts.LotFactory as Address,
    abi: lotFactoryAbi,
    functionName: "lotCount",
  })
  const ids = process.argv.slice(3).map(BigInt)
  console.log(`head ${head}, ${count} lots`)
  for (const lotId of ids.length ? ids : [count]) {
    const lot = await pub.readContract({
      address: dep.contracts.LotFactory as Address,
      abi: lotFactoryAbi,
      functionName: "getLot",
      args: [lotId],
    })
    const s = await pub.readContract({ ...ms, functionName: "saleOf", args: [lotId] })
    const status = await pub.readContract({ ...ms, functionName: "statusOf", args: [lotId] })
    let open = 0
    let unclaimed = 0
    let n = 0n
    for (; ; n++) {
      try {
        const b = await pub.readContract({
          address: lot.auction,
          abi: continuousClearingAuctionAbi,
          functionName: "bids",
          args: [n],
        })
        if (b.exitedBlock === 0n) open++
        else if (b.tokensFilled > 0n) unclaimed++
      } catch {
        break // no bid with this id
      }
    }
    console.log(
      `lot ${lotId}: ends ${lot.endBlock} (${head >= lot.endBlock ? "ended" : `${lot.endBlock - head} blocks left`}), ` +
        `settled ${s.settled}, bids ${n} (unexited ${open}, unclaimed ${unclaimed}), carrier ${s.carrier}, ` +
        `held EUR ${Number(s.heldRemaining) / 1e6}, pickupDeadline ${s.pickupDeadline}, released ${s.released}, ` +
        `complete ${s.complete}, status ${LOT_STATUS[status] ?? status}`,
    )
  }
} catch (e) {
  console.error(`STATUS FAILED: ${safeErrorMessage(e, secrets)}`)
  process.exit(1)
}
