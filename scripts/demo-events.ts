/**
 * Pure formatting for `pnpm demo watch`: one decoded Base Sepolia log -> one line for the sponsor demo, tagged by who
 * did the work (Uniswap CCA, Chainlink CRE, Fairtown settlement). Money is bigint base units (6 decimals); CCA prices
 * are Q96 per lot-token wei. Noise (checkpoints, ticks, role admin) returns undefined. TEST MONEY.
 */
import { fromKey } from "@fairtown/shared/keys"
import { Q96, UNIT } from "@fairtown/shared/units"
import { formatUnits, type Address, type Hex } from "viem"

export type Tag = "UNISWAP CCA" | "CHAINLINK CRE" | "FAIRTOWN"
export type Decoded = { eventName: string; args: Record<string, unknown>; address: Address }
export type Ctx = { name: (a: Address) => string; lotOfAuction: (a: Address) => bigint | undefined; currencyOfLot: (lotId: bigint) => string | undefined }

const money = (v: bigint, cur = "") => `${formatUnits(v, 6)}${cur ? ` ${cur}` : ""}`
/** Q96 per lot-token wei -> currency base units per unit, rounded to nearest (display only; fromQ96 floors, so 9.25 read 9.249999). */
export const perUnit = (q: bigint) => (q * UNIT + Q96 / 2n) / Q96
// Lot tokens have 18 decimals; LotListed.qty and LotSettled.soldUnits are whole units.
const units = (v: bigint) => formatUnits(v, 18)
const b = (v: unknown) => v as bigint
const key = (v: unknown) => fromKey(v as Hex)

export function describe(e: Decoded, ctx: Ctx): { tag: Tag; text: string } | undefined {
  const a = e.args
  const lot = ctx.lotOfAuction(e.address)
  const cur = (id: bigint | undefined) => (id === undefined ? "" : (ctx.currencyOfLot(id) ?? ""))
  const at = lot === undefined ? `auction ${e.address.slice(0, 10)}` : `lot ${lot}`
  switch (e.eventName) {
    case "LotListed":
      return {
        tag: "UNISWAP CCA",
        text: `lot ${a.lotId} listed by ${ctx.name(a.seller as Address)}: ${a.qty} ${key(a.commodity)} at ${key(a.place)}, floor ${money(b(a.floorPerUnit), cur(b(a.lotId)))}/unit; CCA auction ${a.auction} blocks ${a.startBlock}-${a.endBlock}`,
      }
    case "BidSubmitted":
      return { tag: "UNISWAP CCA", text: `${at}: bid ${a.id} by ${ctx.name(a.owner as Address)}, ${money(b(a.amount), cur(lot))} up to ${money(perUnit(b(a.priceQ96)), cur(lot))}/unit (Permit2)` }
    case "ClearingPriceUpdated":
      return { tag: "UNISWAP CCA", text: `${at}: clearing price now ${money(perUnit(b(a.clearingPriceQ96)), cur(lot))}/unit` }
    case "BidExited":
      return { tag: "UNISWAP CCA", text: `${at}: bid ${a.bidId} exited, ${units(b(a.tokensFilled))} units filled, ${money(b(a.currencyRefunded), cur(lot))} refunded to ${ctx.name(a.owner as Address)}` }
    case "TokensClaimed":
      return { tag: "UNISWAP CCA", text: `${at}: ${ctx.name(a.owner as Address)} claimed ${units(b(a.tokensFilled))} lot tokens (bid ${a.bidId})` }
    case "LotSettled":
      return {
        tag: "FAIRTOWN",
        text: `lot ${a.lotId} settled: ${a.soldUnits} units sold, final ${money(b(a.finalClearingPerUnit), cur(b(a.lotId)))}/unit, raised ${money(b(a.raised))}, seller advance ${money(b(a.sellerPaid))} (${Number(a.advanceBps) / 100}%), held ${money(b(a.held))}, fee ${money(b(a.fee))}`,
      }
    case "HandoverConfirmed":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId}: handover to ${ctx.name(a.buyer as Address)} confirmed, ${money(b(a.releasedToSeller))} released to seller` }
    case "LotPaidInFull":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId} paid in full` }
    case "LotDelivered":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId} delivered by truck lot ${a.truckLotId}` }
    case "CarrierAssigned":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId}: truck ${ctx.name(a.carrier as Address)} assigned (truck lot ${a.truckLotId})` }
    case "LotRelisted":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId} relisted as lot ${a.newLotId}, new floor ${money(b(a.newFloorPerUnit))}/unit` }
    case "NoShowReported":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId}: no-show reported by ${ctx.name(a.buyer as Address)}` }
    case "NoShowRefunded":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId}: no-show refund ${money(b(a.refund))} to ${ctx.name(a.buyer as Address)}` }
    case "HeldReleased":
      return { tag: "FAIRTOWN", text: `lot ${a.lotId}: ${money(b(a.amount))} held released to seller` }
    case "DemandSignal":
      return { tag: "CHAINLINK CRE", text: `W2 signal: ${key(a.signalKind)} in ${key(a.place)}, severity ${a.severity}, "${a.label}"` }
    case "FxUpdated":
      return { tag: "CHAINLINK CRE", text: `W1 FX: 1 USD = ${formatUnits(b(a.perUsdE8), 8)} ${key(a.currencyCode)}` }
    case "ReferencePriceUpdated":
      return { tag: "CHAINLINK CRE", text: `W1 reference: ${key(a.commodity)} at ${key(a.market)} ${money(b(a.perUnit), key(a.currencyCode))}/unit (${key(a.sourceTag)})` }
    case "DisputeOpened":
      return { tag: "FAIRTOWN", text: `dispute ${a.disputeId} opened on lot ${a.lotId} by ${ctx.name(a.buyer as Address)} for ${units(b(a.tokenAmount))} units` }
    case "DisputeResolved":
      return { tag: "CHAINLINK CRE", text: `dispute ${a.disputeId} ruled: ${Number(a.refundBps) / 100}% refund` }
    case "DisputeExpired":
      return { tag: "FAIRTOWN", text: `dispute ${a.disputeId} expired without a ruling (timeout outcome)` }
    default:
      return undefined
  }
}

