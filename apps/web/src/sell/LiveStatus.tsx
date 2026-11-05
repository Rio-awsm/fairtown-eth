import { TestMoneyBadge } from "../hud/ModeBadge"
import { explorerTx } from "../hud/links"
import { lotMoney, lotPerUnit, STATUS_WORDS } from "../hud/model"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { useTown } from "../state/townStore"
import { SoldLot } from "./SoldLots"

function PayoutCard({ lot, sellerId }: { lot: LotState; sellerId: string }) {
  const s = lot.settlement!
  return (
    <section aria-label="Payout" className="space-y-2 rounded bg-emerald-950 p-3">
      <p className="text-2xl font-bold">{lotMoney(lot, s.sellerPaid)} received</p>
      <p className="text-sm">
        {lot.handoverTx ? `${lotMoney(lot, s.held)} received at handover` : `${lotMoney(lot, s.held)} more at handover`}{" "}
        · Fee {lotMoney(lot, s.fee)}
      </p>
      <a className="text-sky-300 underline" href={explorerTx(s.tx)} target="_blank" rel="noreferrer">
        Receipt
      </a>
      {!lot.handoverTx && <SoldLot lot={lot} sellerId={sellerId} />}
      <TestMoneyBadge />
    </section>
  )
}

/** The seller's lot after Confirm: bids, price and countdown, then the money received. */
export function LiveStatus({ lotId, sellerId }: { lotId: string; sellerId: string }) {
  const lot = useTown((s) => s.town.lots[lotId])
  const block = useTown((s) => s.town.block)
  if (!lot) return <p className="rounded bg-slate-900 p-3">Opening your stall for Lot {lotId}…</p>
  if (lot.settlement) return <PayoutCard lot={lot} sellerId={sellerId} />
  const price = lot.clearingPerUnit
    ? `now ${lotPerUnit(lot, lot.clearingPerUnit)}`
    : `floor ${lotPerUnit(lot, lot.floorPerUnit)}`
  return (
    <section aria-label="Selling now" className="space-y-1 rounded bg-slate-900 p-3">
      <p className="text-lg font-bold">
        Lot {lot.lotId} · {STATUS_WORDS[lot.status] ?? lot.status}
      </p>
      <p>
        {lot.bids} {lot.bids === 1 ? "bid" : "bids"} · {price}
      </p>
      {lot.status === "open" && <p className="text-amber-300">ends in {countdown(lot.endBlock, block)}</p>}
      <TestMoneyBadge />
    </section>
  )
}
