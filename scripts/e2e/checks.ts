import { splitPayout } from "@fairtown/shared/units"

// Pure assertions for the combine e2e scripts (C 1.1). Expected values come from chain events only.

export class CheckError extends Error {}

export type Settled = {
  lotId: bigint
  finalClearingPerUnit: bigint
  avgPerUnit: bigint
  soldUnits: bigint
  raised: bigint
  sellerPaid: bigint
  held: bigint
  fee: bigint
  advanceBps: number
}

export type Transfer = { token: string; from: string; to: string; value: bigint }
export type Exit = { bidId: bigint; tokensFilled: bigint }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function must(cond: boolean, msg: string): string {
  if (!cond) throw new CheckError(msg)
  return msg
}

/** Settle paid the tier advance and fee exactly, kept the rest held, and the settle tx moved exactly that money. */
export function checkSettlement(
  s: Settled,
  ctx: {
    feeBps: bigint
    expectedAdvanceBps: bigint
    heldOnChain: bigint
    transfers: Transfer[]
    currency: string
    settlement: string
    seller: string
    treasury: string
  },
): string[] {
  const want = splitPayout(s.raised, ctx.feeBps, BigInt(s.advanceBps))
  const paid = (to: string) =>
    ctx.transfers
      .filter((t) => same(t.token, ctx.currency) && same(t.from, ctx.settlement) && same(t.to, to))
      .reduce((sum, t) => sum + t.value, 0n)
  return [
    must(s.soldUnits > 0n, `sold ${s.soldUnits} units, raised ${s.raised}`),
    must(BigInt(s.advanceBps) === ctx.expectedAdvanceBps, `advance tier ${s.advanceBps} bps matches advanceBpsFor`),
    must(
      s.sellerPaid === want.advance && s.held === want.held && s.fee === want.fee,
      `advance ${s.sellerPaid}, held ${s.held}, fee ${s.fee} match splitPayout`,
    ),
    must(s.sellerPaid + s.held + s.fee === s.raised, "advance + held + fee = raised"),
    must(paid(ctx.seller) === s.sellerPaid, `settle tx paid the seller exactly ${s.sellerPaid}`),
    must(paid(ctx.treasury) === s.fee, `settle tx paid the treasury exactly ${s.fee}`),
    must(ctx.heldOnChain === s.held, `heldOf(lot) = ${s.held}`),
  ]
}

/** Every bid was exited; every exit that filled tokens was claimed (the keeper skips empty claims). */
export function checkExits(bidIds: bigint[], exits: Exit[], claimed: bigint[]): string[] {
  const exited = new Map(exits.map((e) => [e.bidId, e.tokensFilled]))
  const missingExit = bidIds.filter((id) => !exited.has(id))
  const toClaim = bidIds.filter((id) => (exited.get(id) ?? 0n) > 0n)
  const missingClaim = toClaim.filter((id) => !claimed.includes(id))
  return [
    must(bidIds.length > 0, `${bidIds.length} bids landed`),
    must(missingExit.length === 0, `every bid exited${missingExit.length ? `, missing ${missingExit.join(", ")}` : ""}`),
    must(
      missingClaim.length === 0,
      `every filled bid claimed (${toClaim.length})${missingClaim.length ? `, missing ${missingClaim.join(", ")}` : ""}`,
    ),
  ]
}

export type PriceEntity = { lotId: bigint; finalClearingPerUnit: bigint; avgPerUnit: bigint; soldUnits: bigint; tx: string }

/** The Arkiv price entity for this lot carries the settle event's prices and its tx. */
export function checkArkivPrice(found: PriceEntity[], s: Settled, settleTx: string): string[] {
  const p = found.find((e) => same(e.tx, settleTx))
  must(p !== undefined, `Arkiv price entity for lot ${s.lotId} with settle tx ${settleTx}`)
  return [
    `Arkiv price entity for lot ${s.lotId} found`,
    must(
      p!.lotId === s.lotId && p!.finalClearingPerUnit === s.finalClearingPerUnit && p!.avgPerUnit === s.avgPerUnit,
      `Arkiv final ${p!.finalClearingPerUnit} and average ${p!.avgPerUnit} match LotSettled`,
    ),
    must(p!.soldUnits === s.soldUnits, `Arkiv soldUnits ${p!.soldUnits} matches`),
  ]
}

// ---------------------------------------------------------------------------------------------- trust (C 1.3)

/** MarketSettlement._share: a reporter's slice of what is still held, by their tokens over the outstanding ones. */
export const shareOf = (held: bigint, tokens: bigint, outstanding: bigint) =>
  tokens >= outstanding ? held : (held * tokens) / outstanding

/** Uncontested no-show: the buyer gets exactly their share back, held drops by it, the seller's record resets. */
export function checkNoShowRefund(c: {
  heldBefore: bigint
  outstanding: bigint
  tokens: bigint
  refund: bigint
  paidToBuyer: bigint
  heldAfter: bigint
  noShowsBefore: number
  record: { cleanLots: number; noShows: number }
}): string[] {
  const want = shareOf(c.heldBefore, c.tokens, c.outstanding)
  return [
    must(c.refund === want, `refund ${c.refund} = share of held (${want})`),
    must(c.paidToBuyer === c.refund, `finalize tx paid the buyer exactly ${c.refund}`),
    must(c.heldAfter === c.heldBefore - c.refund, `held ${c.heldBefore} -> ${c.heldAfter}`),
    must(c.record.noShows === c.noShowsBefore + 1, `seller no-shows ${c.noShowsBefore} -> ${c.record.noShows}`),
    must(c.record.cleanLots === 0, "seller clean lots reset to 0"),
  ]
}

/** Contested no-show ruling: the disputed share splits by refundBps exactly as resolveRuling does. */
export function checkRuling(c: {
  heldBefore: bigint
  outstanding: bigint
  tokens: bigint
  refundBps: bigint
  refundToBuyer: bigint
  paidToSeller: bigint
  sellerTransfer: bigint
  buyerTransfer: bigint
}): string[] {
  const share = shareOf(c.heldBefore, c.tokens, c.outstanding)
  const refund = (share * c.refundBps) / 10_000n
  return [
    must(c.refundToBuyer === refund && c.paidToSeller === share - refund, `ruling ${c.refundBps} bps: buyer ${c.refundToBuyer}, seller ${c.paidToSeller} of share ${share}`),
    must(c.sellerTransfer === c.paidToSeller, `ruling tx paid the seller exactly ${c.paidToSeller}`),
    must(c.buyerTransfer === c.refundToBuyer, `ruling tx refunded the buyer exactly ${c.refundToBuyer}`),
  ]
}

/** Buyer silence: after the report window everything still held (nobody reported) goes to the seller. */
export function checkSilence(c: { heldBefore: bigint; released: bigint; sellerTransfer: bigint; heldAfter: bigint }): string[] {
  return [
    must(c.heldBefore > 0n, `${c.heldBefore} was held`),
    must(c.released === c.heldBefore, `HeldReleased ${c.released} = everything held`),
    must(c.sellerTransfer === c.released, `release tx paid the seller exactly ${c.released}`),
    must(c.heldAfter === 0n, "nothing left held"),
  ]
}
