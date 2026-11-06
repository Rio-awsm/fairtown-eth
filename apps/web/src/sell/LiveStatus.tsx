import { TestMoneyBadge } from "../hud/ModeBadge"
import { explorerTx, LOCAL_FORK_TITLE } from "../hud/links"
import { lotMoney, lotPerUnit, STATUS_WORDS } from "../hud/model"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { useTown } from "../state/townStore"
import { SoldLot } from "./SoldLots"

function PayoutCard({ lot, sellerId }: { lot: LotState; sellerId: string }) {
  const s = lot.settlement!
  return (
    <section aria-label="Payout" className="rpg-window space-y-2 bg-meadow-tint p-4">
      <p className="text-2xl font-bold">{lotMoney(lot, s.sellerPaid)} received</p>
      <p className="text-sm">
        {lot.handoverTx ? `${lotMoney(lot, s.held)} received at handover` : `${lotMoney(lot, s.held)} more at handover`}{" "}
        · Fee {lotMoney(lot, s.fee)}
      </p>
      {explorerTx(s.tx) ? (
        <a className="text-harbour underline" href={explorerTx(s.tx)} target="_blank" rel="noreferrer">
          Receipt
        </a>
      ) : (
        <span title={LOCAL_FORK_TITLE}>Receipt (local fork)</span>
      )}
      {!lot.handoverTx && <SoldLot lot={lot} sellerId={sellerId} />}
      <TestMoneyBadge />
    </section>
  )
}

/** The seller's lot after Confirm: bids, price and countdown, then the money received. */
export function LiveStatus({ lotId, sellerId }: { lotId: string; sellerId: string }) {
  const lot = useTown((s) => s.town.lots[lotId])
  const block = useTown((s) => s.town.block)
  if (!lot) return <p className="rpg-window p-4">Opening your stall for Lot {lotId}…</p>
  if (lot.settlement) return <PayoutCard lot={lot} sellerId={sellerId} />
  const price = lot.clearingPerUnit
    ? `now ${lotPerUnit(lot, lot.clearingPerUnit)}`
    : `floor ${lotPerUnit(lot, lot.floorPerUnit)}`
  return (
    <section aria-label="Selling now" className="rpg-window space-y-1 p-4">
      <p className="text-lg font-bold">
        Lot {lot.lotId} · {STATUS_WORDS[lot.status] ?? lot.status}
      </p>
      <p>
        {lot.bids} {lot.bids === 1 ? "bid" : "bids"} · {price}
      </p>
      {lot.status === "open" && <p className="text-gold-ink">ends in {countdown(lot.endBlock, block)}</p>}
      <TestMoneyBadge />
    </section>
  )
}
