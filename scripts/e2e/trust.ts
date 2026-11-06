/**
 * C 1.3 e2e:trust, the money outcomes when a handover does not happen, on the anvil fork with keeper and agents:
 *   1. uncontested no-show: the buyer reports through the API, the keeper finalizes; exact refund, seller record reset
 *   2. contested no-show: the seller contests through the API (PIN session), a MOCKED ruling arrives through the
 *      receiver's forwarder (W3, S1 4.4, is not built; the mock sends the report W3 would); exact split
 *   3. buyer silence: past the report window the keeper releases everything held to the seller
 * Blocks are fast-forwarded with anvil_mine. Expected values come from chain reads and events. `pnpm e2e:trust`.
 */
import { disputeResolverAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import {
  concat,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  pad,
  parseEventLogs,
  toHex,
  zeroAddress,
  type AbiEvent,
  type Address,
  type Hash,
  type Log,
  type TransactionReceipt,
} from "viem"
import { baseSepolia } from "viem/chains"
import { checkNoShowRefund, checkRuling, checkSilence } from "./checks"
import { ANVIL_URL, API, env, Run, startStack } from "./stack"

const run = new Run("e2e-trust", "anvil")
console.log("Fairtown e2e:trust on anvil (TEST MONEY)")
if (!env.SELLER_PIN) throw new Error("SELLER_PIN is unset in .env: the seller cannot contest")
const dep = await loadDeployment("anvil")
const settlement = dep.contracts.MarketSettlement as Address
const resolver = dep.contracts.DisputeResolver as Address
// Buyers would report every lot automatically after the deadline (D-89); this run stages each path itself.
const { pub } = await startStack(run, { env: { AGENTS_AUTO_NOSHOW: "0" } })
const test = createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(ANVIL_URL) })
const ms = { address: settlement, abi: marketSettlementAbi } as const
const ev = (abi: readonly unknown[], name: string) => (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!

async function post<T>(path: string, body: object, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as T & { error?: { code: string; message: string } }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`)
  return json
}
const mine = async (blocks: bigint) => {
  await test.mine({ blocks: Number(blocks) })
  run.say(`..  mined ${blocks} blocks to ${await pub.getBlockNumber()}`)
}
const logsOf = async (event: string, args: object) =>
  (await pub.getLogs({ address: settlement, event: ev(marketSettlementAbi, event), args, fromBlock: start, toBlock: "latest" } as never)) as Log[]
const paid = (r: TransactionReceipt, currency: Address, to: Address) =>
  parseEventLogs({ abi: erc20Abi, logs: r.logs, eventName: "Transfer" })
    .filter((t) => t.address.toLowerCase() === currency.toLowerCase() && t.args.from.toLowerCase() === settlement.toLowerCase() && t.args.to.toLowerCase() === to.toLowerCase())
    .reduce((s, t) => s + t.args.value, 0n)
const heldAt = async (lotId: bigint, blockNumber?: bigint) =>
  (await pub.readContract({ ...ms, functionName: "heldOf", args: [lotId], ...(blockNumber ? { blockNumber } : {}) }))[0]

const start = await pub.getBlockNumber()

// 1. Three lots at once, one per path.
type Lot = { lotId: bigint; seller: Address; currency: Address; auction: Address; pickupDeadline: bigint; soldTokens: bigint; winners: { buyer: Address; tokenAmount: bigint }[] }
const lots: Lot[] = []
for (const path of ["no-show", "contested", "silence"]) {
  const d = await post<{ draftId: string }>("/api/listings/draft", { sellerId: "ingrid", text: "60 kg cod, Bergen" })
  const c = await post<{ lotId: string; auction: Address; tx: Hash }>("/api/listings/confirm", { draftId: d.draftId, floorPerUnit: "7500000", durationBlocks: 40 })
  const r = await pub.waitForTransactionReceipt({ hash: c.tx })
  const [l] = parseEventLogs({ abi: lotFactoryAbi, logs: r.logs, eventName: "LotListed" })
  lots.push({ lotId: BigInt(c.lotId), seller: l!.args.seller, currency: l!.args.currency, auction: c.auction, pickupDeadline: 0n, soldTokens: 0n, winners: [] })
  run.say(`ok  lot ${c.lotId} listed for the ${path} path`)
}

// 2. Agents bid, the keeper settles and claims, so each winner holds lot tokens.
for (const lot of lots) {
  const [s] = await run.until(`LotSettled ${lot.lotId}`, 5 * 60_000, async () => {
    const l = await logsOf("LotSettled", { lotId: lot.lotId })
    return l.length ? parseEventLogs({ abi: marketSettlementAbi, logs: l, eventName: "LotSettled" }) : undefined
  })
  lot.pickupDeadline = s!.args.pickupDeadline
  lot.winners = await run.until(`claimed winners of lot ${lot.lotId}`, 3 * 60_000, async () => {
    const v = await (await fetch(`${API}/api/lots/${lot.lotId}`)).json() as { winners?: { buyer: Address; tokenAmount: string }[] }
    return v.winners?.length ? v.winners.map((w) => ({ buyer: w.buyer, tokenAmount: BigInt(w.tokenAmount) })) : undefined
  })
  lot.soldTokens = (await pub.readContract({ ...ms, functionName: "heldOf", args: [lot.lotId] }))[1]
  run.say(`ok  lot ${lot.lotId} sold (${s!.args.soldUnits} kg), held ${s!.args.held}, ${lot.winners.length} winners hold tokens`)
}
const [noShow, contested, silence] = lots as [Lot, Lot, Lot]

// 3. Past every pickup deadline, the buyers of the first two lots report; the seller contests the second.
const deadline = lots.reduce((m, l) => (l.pickupDeadline > m ? l.pickupDeadline : m), 0n)
await mine(deadline + 1n - (await pub.getBlockNumber()))
const a = noShow.winners[0]!
const b = contested.winners[0]!
const heldA = await heldAt(noShow.lotId)
const recordBefore = await pub.readContract({ ...ms, functionName: "sellerRecord", args: [noShow.seller] })
await post("/api/noshow/report", { buyerId: a.buyer, lotId: noShow.lotId.toString(), tokenAmount: a.tokenAmount.toString() })
run.say(`ok  ${a.buyer} reported a no-show on lot ${noShow.lotId}`)
await post("/api/noshow/report", { buyerId: b.buyer, lotId: contested.lotId.toString(), tokenAmount: b.tokenAmount.toString() })
const session = await post<{ token: string }>("/api/sessions/seller", { sellerId: "ingrid", pin: env.SELLER_PIN })
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const photo = { dataUrl: `data:image/png;base64,${png}`, lotCode: String(contested.lotId % 10000n).padStart(4, "0"), capturedAt: new Date().toISOString() }
const { disputeId } = await post<{ disputeId: string }>(
  "/api/noshow/contest",
  { sellerId: "ingrid", lotId: contested.lotId.toString(), buyer: b.buyer, photos: [photo] },
  session.token,
)
run.say(`ok  the seller contested lot ${contested.lotId} with a photo: dispute ${disputeId}`)

// 4. Uncontested: after the contest window the keeper finalizes the refund.
await mine(BigInt(await pub.readContract({ ...ms, functionName: "contestWindowBlocks" })) + 1n)
const refundLog = await run.until("NoShowRefunded", 3 * 60_000, async () => (await logsOf("NoShowRefunded", { lotId: noShow.lotId }))[0])
const refundTx = await pub.getTransactionReceipt({ hash: refundLog.transactionHash! })
const [refundEv] = parseEventLogs({ abi: marketSettlementAbi, logs: refundTx.logs, eventName: "NoShowRefunded" })
const [rec] = parseEventLogs({ abi: marketSettlementAbi, logs: refundTx.logs, eventName: "SellerRecordUpdated" })
run.ok(
  checkNoShowRefund({
    heldBefore: heldA,
    outstanding: noShow.soldTokens,
    tokens: a.tokenAmount,
    refund: refundEv!.args.refund,
    paidToBuyer: paid(refundTx, noShow.currency, a.buyer),
    heldAfter: await heldAt(noShow.lotId, refundTx.blockNumber),
    noShowsBefore: Number(recordBefore[1]),
    record: { cleanLots: Number(rec!.args.cleanLots), noShows: Number(rec!.args.noShows) },
  }),
)

// 5. Contested: the MOCKED ruling (seller showed up, 0% refund) through the receiver's forwarder.
const forwarder = await pub.readContract({ address: resolver, abi: disputeResolverAbi, functionName: "forwarder" })
const owner = await pub.readContract({ address: resolver, abi: disputeResolverAbi, functionName: "expectedWorkflowOwner" })
const metadata = owner === zeroAddress ? "0x" : concat([pad("0x", { size: 42 }), owner]) // workflow owner at bytes 42..62
const report = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint16" }, { type: "bytes32" }],
  [BigInt(disputeId), 0, keccak256(toHex("e2e mocked ruling: the seller showed up"))],
)
const heldB = await heldAt(contested.lotId)
await test.impersonateAccount({ address: forwarder })
await test.setBalance({ address: forwarder, value: 10n ** 18n })
const rulingHash = await createWalletClient({ account: forwarder, chain: baseSepolia, transport: http(ANVIL_URL) }).writeContract({
  address: resolver,
  abi: disputeResolverAbi,
  functionName: "onReport",
  args: [metadata, report],
})
await test.stopImpersonatingAccount({ address: forwarder })
const rulingTx = await pub.waitForTransactionReceipt({ hash: rulingHash })
if (rulingTx.status !== "success") throw new Error("mocked ruling reverted")
const [settledRuling] = parseEventLogs({ abi: marketSettlementAbi, logs: rulingTx.logs, eventName: "RulingSettled" })
const [resolved] = parseEventLogs({ abi: disputeResolverAbi, logs: rulingTx.logs, eventName: "DisputeResolved" })
run.ok([`DisputeResolved dispute ${resolved!.args.disputeId} lot ${resolved!.args.lotId}, refund ${resolved!.args.refundBps} bps (mocked W3 ruling)`])
run.ok(
  checkRuling({
    heldBefore: heldB,
    outstanding: contested.soldTokens,
    tokens: b.tokenAmount,
    refundBps: 0n,
    refundToBuyer: settledRuling!.args.refundToBuyer,
    paidToSeller: settledRuling!.args.paidToSeller,
    sellerTransfer: paid(rulingTx, contested.currency, contested.seller),
    buyerTransfer: paid(rulingTx, contested.currency, b.buyer),
  }),
)

// 6. Silence: nobody reported on the third lot; past its report window the keeper releases held to the seller.
const heldC = await heldAt(silence.lotId)
const reportWindow = BigInt(await pub.readContract({ ...ms, functionName: "reportWindowBlocks" }))
await mine(silence.pickupDeadline + reportWindow + 1n - (await pub.getBlockNumber()))
const releaseLog = await run.until("HeldReleased", 3 * 60_000, async () => (await logsOf("HeldReleased", { lotId: silence.lotId }))[0])
const releaseTx = await pub.getTransactionReceipt({ hash: releaseLog.transactionHash! })
const [released] = parseEventLogs({ abi: marketSettlementAbi, logs: releaseTx.logs, eventName: "HeldReleased" })
run.ok(
  checkSilence({
    heldBefore: heldC,
    released: released!.args.amount,
    sellerTransfer: paid(releaseTx, silence.currency, silence.seller),
    heldAfter: await heldAt(silence.lotId, releaseTx.blockNumber),
  }),
)

run.stop()
console.log(`\nE2E TRUST PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s (ruling mocked: W3 is not built)`)
console.log(`  service logs: ${run.runDir}`)
process.exit(0)
