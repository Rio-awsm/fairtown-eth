import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { api } from "../net/api"
import { ApiClientError } from "../net/apiClient"
import { useTown } from "../state/townStore"
import { formatBps, unitLabel } from "../money/format"
import { TxLink } from "./links"
import { lotMoney, lotPerUnit, nameOf } from "./model"
import { PriceChart } from "./PriceChart"
import { Timeline } from "./Timeline"

/** The grade report inside LotView. Lenient: only `tee_verified === true` earns the badge. */
const GradeReport = z.looseObject({
  grade: z.string(),
  confidence: z.number().optional(),
  standard: z.string().optional(),
  defects: z.array(z.string()).optional(),
  tee_verified: z.unknown().optional(),
})
function gradeOf(view: unknown) {
  const v = view as { gradeReport?: unknown; spec?: { gradeReport?: unknown } } | undefined
  const parsed = GradeReport.safeParse(v?.gradeReport ?? v?.spec?.gradeReport)
  return parsed.success ? parsed.data : undefined
}

function Grade({ lotId }: { lotId: string }) {
  const view = useQuery({ queryKey: ["lot", lotId], queryFn: () => api.lot({ params: { lotId } }) })
  if (view.isPending) return <p className="text-xs text-ink-soft">Loading grade report…</p>
  if (view.isError) {
    const code = view.error instanceof ApiClientError ? view.error.code : "error"
    return <p className="text-xs text-brick">Grade report unavailable ({code})</p>
  }
  const grade = gradeOf(view.data)
  if (!grade) return <p className="text-xs text-ink-soft">No grade report</p>
  return (
    <p className="text-sm" title="GET /api/lots/:lotId">
      Grade {grade.grade}
      {grade.confidence !== undefined && ` · ${Math.round(grade.confidence * 100)}% confidence`}
      {grade.standard && ` · ${grade.standard}`}
      {grade.tee_verified === true && <span className="rpg-badge ml-2 bg-moss text-parchment-light">Verified</span>}
    </p>
  )
}

/** A deadline only matters while the lot is between sale and paid in full, and not refunded. */
const hasOpenDeadline = (lot: LotState) => lot.progress > 0 && lot.progress < 5 && lot.status !== "refunded"

function Row({ label, value, source }: { label: string; value: string | undefined; source: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd title={source}>{value ?? "—"}</dd>
    </div>
  )
}

export function LotPanel({ lotId }: { lotId: string }) {
  const town = useTown((s) => s.town)
  const select = useTown((s) => s.select)
  const timeline = useQuery({ queryKey: ["timeline", lotId], queryFn: () => api.lotTimeline({ params: { lotId } }) })
  const lot = town.lots[lotId]
  if (!lot) return <p>Lot {lotId} has not been seen yet.</p>
  const seller = town.sellers[lot.seller]
  const children = Object.values(town.lots).filter((l) => l.parentLotId === lotId || l.lotId === lot.relistedAs)
  const settled = lot.settlement
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">
        Lot {lot.lotId} · {lot.qty} {unitLabel(lot.unit)} {lot.commodity}
      </h2>
      <p className="text-sm">
        {lot.sellerName}
        {seller && <span className="rpg-badge ml-2 bg-parchment-deep">{seller.proven ? "Proven" : "New"}</span>}
        <span className="ml-2 text-ink-soft">{lot.place}</span>
      </p>
      <Grade lotId={lotId} />
      <dl className="text-sm">
        <Row label="Floor" value={lotPerUnit(lot, lot.floorPerUnit)} source="lot.listed event" />
        <Row
          label="Final clearing"
          value={settled && lot.clearingPerUnit ? lotPerUnit(lot, lot.clearingPerUnit) : undefined}
          source={`lot.settled event${settled ? `, tx ${settled.tx}` : ""}`}
        />
        <Row
          label="Average paid"
          value={lot.avgPerUnit ? lotPerUnit(lot, lot.avgPerUnit) : undefined}
          source={`lot.settled event${settled ? `, tx ${settled.tx}` : ""}`}
        />
      </dl>
      <PriceChart priceLog={lot.priceLog} currency={lot.currency} />
      <table className="w-full text-xs" aria-label="Bids">
        <thead>
          <tr className="text-left text-ink-soft">
            <th>Bidder</th>
            <th>Max</th>
            <th>Amount</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {lot.bidLog.map((b) => (
            <tr key={b.tx}>
              <td>
                <button className="underline" onClick={() => select({ kind: "agent", id: b.agentId })}>
                  {nameOf(town, b.agentId)}
                </button>
              </td>
              <td title="bid.placed event">{lotPerUnit(lot, b.maxPerUnit)}</td>
              <td title="bid.placed event">{lotMoney(lot, b.amount)}</td>
              <td>
                <TxLink tx={b.tx} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {settled && (
        <section aria-label="Payout" className="text-sm">
          <dl>
            <Row
              label="Seller now"
              value={lotMoney(lot, settled.sellerPaid)}
              source={`lot.settled, tx ${settled.tx}`}
            />
            <Row
              label="Held until handover"
              value={lotMoney(lot, settled.held)}
              source={`lot.settled, tx ${settled.tx}`}
            />
            <Row label="Fee" value={lotMoney(lot, settled.fee)} source={`lot.settled, tx ${settled.tx}`} />
            <Row label="Advance" value={formatBps(settled.advanceBps)} source={`lot.settled, tx ${settled.tx}`} />
          </dl>
          <TxLink tx={settled.tx} />
        </section>
      )}
      <dl className="text-sm">
        <Row
          label="Auction ends"
          value={lot.status === "open" ? `in ${countdown(lot.endBlock, town.block)}` : `block ${lot.endBlock}`}
          source="lot.listed endBlock"
        />
        {lot.deadlineBlock !== undefined && hasOpenDeadline(lot) && (
          <Row
            label="Next deadline"
            value={`in ${countdown(lot.deadlineBlock, town.block)}`}
            source={`block ${lot.deadlineBlock}`}
          />
        )}
      </dl>
      <Timeline lot={lot} block={town.block} {...(timeline.data ? { apiSteps: timeline.data.steps } : {})} />
      {(lot.parentLotId !== "0" || children.length > 0) && (
        <p className="flex flex-wrap gap-2 text-xs">
          {lot.parentLotId !== "0" && (
            <>
              <span className="text-ink-soft">Parent</span>
              <button className="underline" onClick={() => select({ kind: "lot", id: lot.parentLotId })}>
                Lot {lot.parentLotId}
              </button>
            </>
          )}
          {children.length > 0 && <span className="text-ink-soft">Next</span>}
          {children.map((c) => (
            <button key={c.lotId} className="underline" onClick={() => select({ kind: "lot", id: c.lotId })}>
              Lot {c.lotId}
            </button>
          ))}
        </p>
      )}
    </div>
  )
}
