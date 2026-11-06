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
