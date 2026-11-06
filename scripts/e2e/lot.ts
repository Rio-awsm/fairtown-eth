/**
 * C 1.1 e2e: the API lists a lot, agents bid, the keeper settles, money is exact, the price lands on Arkiv.
 *   pnpm e2e:lot                          anvil fork of Base Sepolia, ARKIV_MODE=memory, rule bidders (MOCK_AI=1)
 *   pnpm e2e:lot --network base-sepolia   real chain, live Arkiv (Rabdi), the configured LLM
 * Starts the keeper and the agents service itself; stop your own copies first. Expected values come from chain
 * events only. Never prints keys, the mnemonic or RPC URLs. Service logs go to .data/e2e/<run>/. TEST MONEY.
 */
import { createPublicClient as createArkivClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { u256 } from "@arkiv-network/sdk/schema"
import { continuousClearingAuctionAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { ARKIV_SDK_SCHEMAS } from "@fairtown/shared/arkiv"
import { erc20Abi, http, parseEventLogs, type AbiEvent, type Address, type Hash } from "viem"
import { checkArkivPrice, checkExits, checkSettlement, type PriceEntity, type Settled } from "./checks"
import { env, parseNetwork, Run, startStack } from "./stack"

const network = parseNetwork(process.argv, "e2e:lot")
const SELLER_ID = "ingrid" // EUR fish seller in Bergen; three cod buyers (hanse_kitchen, fjord_processing, oslo_fiskehall)
const LISTING = { text: "120 kg cod, Bergen", floorPerUnit: "7500000" } // EUR 7.50 per kg
const DURATION_BLOCKS = network === "anvil" ? 40 : 450 // anvil mines 1 block/s; Base ~5 blocks/s (D-50)
const LIMIT_MS = network === "anvil" ? 8 * 60_000 : 15 * 60_000
const ev = (abi: readonly unknown[], name: string) =>
  (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!

const run = new Run("e2e-lot", network)
console.log(`Fairtown e2e:lot on ${network} (TEST MONEY)`)
const dep = await loadDeployment(network)
const settlement = dep.contracts.MarketSettlement as Address
const { pub, logsClient } = await startStack(run)

// 3. List through the API: draft, then confirm.
const draft = await run.api<{ draftId: string }>("/api/listings/draft", { sellerId: SELLER_ID, text: LISTING.text })
const listed = await run.api<{ lotId: string; auction: Address; token: Address; tx: Hash }>("/api/listings/confirm", {
  draftId: draft.draftId,
  floorPerUnit: LISTING.floorPerUnit,
  durationBlocks: DURATION_BLOCKS,
})
const lotId = BigInt(listed.lotId)
const listReceipt = await pub.waitForTransactionReceipt({ hash: listed.tx })
const [lotEv] = parseEventLogs({ abi: lotFactoryAbi, logs: listReceipt.logs, eventName: "LotListed" })
if (!lotEv) throw new Error("confirm tx has no LotListed event")
const { seller, currency, sector, endBlock, qty } = lotEv.args
const expectedAdvanceBps = BigInt(
  await pub.readContract({
    address: settlement,
    abi: marketSettlementAbi,
    functionName: "advanceBpsFor",
    args: [seller, sector],
    blockNumber: listReceipt.blockNumber,
  }),
)
run.say(`ok  lot ${lotId} listed: ${qty} kg cod, auction ${listed.auction}, ends at block ${endBlock}`)

// 4. Agents bid, the keeper settles: wait for LotSettled.
const settledEv = ev(marketSettlementAbi, "LotSettled")
const settledLog = await run.until("LotSettled", LIMIT_MS, async () => {
  const head = await pub.getBlockNumber()
  if (head < endBlock) return undefined
  const [log] = await run.logsIn(logsClient, settlement, settledEv, listReceipt.blockNumber, head, { lotId })
  return log
})
const [settledParsed] = parseEventLogs({ abi: marketSettlementAbi, logs: [settledLog], eventName: "LotSettled" })
const a = settledParsed!.args
const settled: Settled = {
  lotId: a.lotId,
  finalClearingPerUnit: a.finalClearingPerUnit,
  avgPerUnit: a.avgPerUnit,
  soldUnits: a.soldUnits,
  raised: a.raised,
  sellerPaid: a.sellerPaid,
  held: a.held,
  fee: a.fee,
  advanceBps: Number(a.advanceBps),
}
const settleTx = settledLog.transactionHash!
const settleReceipt = await pub.getTransactionReceipt({ hash: settleTx })
run.say(`ok  settled in block ${settleReceipt.blockNumber}: final ${a.finalClearingPerUnit}, average ${a.avgPerUnit}`)

// 5. Money is exact: tier advance, fee and held from splitPayout; the settle tx moved exactly that.
const at = { blockNumber: settleReceipt.blockNumber } as const
const [heldOnChain] = await pub.readContract({
  address: settlement,
  abi: marketSettlementAbi,
  functionName: "heldOf",
  args: [lotId],
  ...at,
})
const treasury = await pub.readContract({ address: settlement, abi: marketSettlementAbi, functionName: "treasury", ...at })
const feeBps = BigInt(await pub.readContract({ address: settlement, abi: marketSettlementAbi, functionName: "feeBps", ...at }))
const transfers = parseEventLogs({ abi: erc20Abi, logs: settleReceipt.logs, eventName: "Transfer" }).map((t) => ({
  token: t.address,
  from: t.args.from,
  to: t.args.to,
  value: t.args.value,
}))
run.ok(checkSettlement(settled, { feeBps, expectedAdvanceBps, heldOnChain, transfers, currency, settlement, seller, treasury }))

// 6. The keeper exits every bid and claims every filled one.
const bidSubmitted = ev(continuousClearingAuctionAbi, "BidSubmitted")
const bidExited = ev(continuousClearingAuctionAbi, "BidExited")
const tokensClaimed = ev(continuousClearingAuctionAbi, "TokensClaimed")
const exitLines = await run.until("exits and claims", 4 * 60_000, async () => {
  const head = await pub.getBlockNumber()
  const from = listReceipt.blockNumber
  const parse = async (event: AbiEvent) =>
    parseEventLogs({ abi: continuousClearingAuctionAbi, logs: await run.logsIn(logsClient, listed.auction, event, from, head) })
  const bids = (await parse(bidSubmitted)).flatMap((l) => (l.eventName === "BidSubmitted" ? [l.args.id] : []))
  const exits = (await parse(bidExited)).flatMap((l) =>
    l.eventName === "BidExited" ? [{ bidId: l.args.bidId, tokensFilled: l.args.tokensFilled }] : [],
  )
  const claims = (await parse(tokensClaimed)).flatMap((l) => (l.eventName === "TokensClaimed" ? [l.args.bidId] : []))
  try {
    return checkExits(bids, exits, claims)
  } catch {
    return undefined
  }
}, 3_000)
run.ok(exitLines)

// 7. Arkiv: the price entity on live Rabdi (base-sepolia only; the anvil run keeps Arkiv in memory, D-114).
if (network === "base-sepolia") {
  if (!env.ARKIV_ACCESS_KEY) throw new Error("ARKIV_ACCESS_KEY is unset")
  const reader = createArkivClient({ chain: rabdi({ accessKey: env.ARKIV_ACCESS_KEY }), transport: http() })
  const cols = { $key: true, lotId: true, finalClearingPerUnit: true, avgPerUnit: true, soldUnits: true, tx: true } as const
  // The SDK returns typed values: { type: "u256", value: 4n }.
  const raw = (v: unknown) => (v !== null && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v)
  const big = (v: unknown) => BigInt(String(raw(v)))
  let key = ""
  const lines = await run.until("Arkiv price entity", 3 * 60_000, async () => {
    const { entities } = await (reader.select(cols as never) as never as { from: (s: unknown) => { where: (e: unknown) => { limit: (n: number) => { fetch: () => Promise<{ entities: Record<string, unknown>[] }> } } } })
      .from(ARKIV_SDK_SCHEMAS.price)
      .where(eq("lotId", u256(lotId)))
      .limit(20)
      .fetch()
    const found: PriceEntity[] = entities.map((e) => ({
      lotId: big(e.lotId),
      finalClearingPerUnit: big(e.finalClearingPerUnit),
      avgPerUnit: big(e.avgPerUnit),
      soldUnits: big(e.soldUnits),
      tx: String(raw(e.tx)),
    }))
    const hit = entities.find((e) => String(raw(e.tx)).toLowerCase() === settleTx.toLowerCase())
    if (!hit) return undefined
    key = String(hit.$key)
    return checkArkivPrice(found, settled, settleTx)
  }, 5_000)
  run.ok(lines)
  run.say(`    Arkiv entity: https://rabdi.explorer.arkiv.network/entity/${key}`)
}

run.stop()
const explorer = (env.EXPLORER_URL || "https://sepolia.basescan.org").replace(/\/$/, "")
console.log(`\nE2E LOT PASSED on ${network} in ${((Date.now() - run.started) / 1000).toFixed(0)}s`)
if (network === "base-sepolia") {
  console.log(`  auction: ${explorer}/address/${listed.auction}`)
  console.log(`  listed:  ${explorer}/tx/${listed.tx}`)
  console.log(`  settled: ${explorer}/tx/${settleTx}`)
}
console.log(`  service logs: ${run.runDir}`)
process.exit(0)
