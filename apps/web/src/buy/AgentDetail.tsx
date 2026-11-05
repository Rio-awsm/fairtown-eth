import { CURRENCIES, type Currency } from "@fairtown/shared/keys"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router"
import { z } from "zod"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { noShowReportable } from "../handover/model"
import { ReportProblem } from "../handover/ReportProblem"
import { AddressLink, TxLink } from "../hud/links"
import { lotMoney, lotPerUnit, STATUS_WORDS } from "../hud/model"
import { Timeline } from "../hud/Timeline"
import { formatMoney, toDecimalString } from "../money/format"
import { api } from "../net/api"
import { parseFloorInput } from "../sell/model"
import { useTown } from "../state/townStore"
import { useWinners } from "./useWinners"

const Dec = z.string().regex(/^\d+$/)
const Details = z.looseObject({
  name: z.string().optional(),
  role: z.string().optional(),
  persona: z.string().optional(),
  currency: z.enum(CURRENCIES).optional(),
  budget: Dec.optional(),
  paused: z.boolean().optional(),
  mandate: z
    .looseObject({
      commodities: z.array(z.string()).optional(),
      maxPerUnit: Dec.optional(),
      qty: z.string().optional(),
      minGrade: z.string().optional(),
      place: z.string().optional(),
      avoidNoShowSellers: z.boolean().optional(),
    })
    .optional(),
  families: z.array(z.object({ name: z.string(), qty: z.string() })).optional(),
})
const asInput = (base: string) => toDecimalString(BigInt(base)).replace(/0+$/, "").replace(/\.$/, "")

function NoShow({ lot, agentId, tokenAmount }: { lot: LotState; agentId: string; tokenAmount: string }) {
  const block = useTown((s) => s.town.block)
  const report = useMutation({
    mutationFn: () => api.noshowReport({ body: { buyerId: agentId, lotId: lot.lotId, tokenAmount } }),
  })
  if (report.isSuccess)
    return <p role="status">Reported. The seller has until block {report.data.contestEnds} to answer.</p>
  if (report.isError) return <p role="alert">We could not send the report. Please try again.</p>
  if (lot.deadlineBlock === undefined || !["sold", "truck_booked"].includes(lot.status)) return null
  if (!noShowReportable(lot, block))
    return (
      <p className="text-sm text-slate-300">
        You can report a no-show after the pickup deadline, in {countdown(lot.deadlineBlock, block)}.
      </p>
    )
  return (
    <button
      className="rounded bg-red-700 px-4 py-2 font-bold"
      disabled={report.isPending}
      onClick={() => report.mutate()}
    >
      Seller didn't come
    </button>
  )
}

function Purchase({ lot, agentId }: { lot: LotState; agentId: string }) {
  const block = useTown((s) => s.town.block)
  const winners = useWinners(lot)
  const [reporting, setReporting] = useState(false)
  if (!winners) return <li className="rounded bg-slate-800 p-3">Lot {lot.lotId} · checking the result…</li>
  const mine = winners.find((w) => w.buyer.toLowerCase() === agentId.toLowerCase())
  return (
    <li className="space-y-2 rounded bg-slate-800 p-3">
      <p>
        Lot {lot.lotId} · {lot.qty} {lot.unit} {lot.commodity} from {lot.sellerName} ·{" "}
        {mine ? (STATUS_WORDS[lot.status] ?? lot.status) : "Not won"}
      </p>
      {mine && (
        <>
          <Timeline lot={lot} block={block} />
          <NoShow lot={lot} agentId={agentId} tokenAmount={mine.tokenAmount} />
          {reporting ? (
            <ReportProblem buyerId={agentId} lotId={lot.lotId} tokenAmount={mine.tokenAmount} />
          ) : (
            <button className="rounded bg-slate-700 px-4 py-2" onClick={() => setReporting(true)}>
              Report a problem
            </button>
          )}
        </>
      )}
    </li>
  )
}

/** One buyer agent: mandate, budget, pause and edit, decisions, bids, purchases and handovers (S3 3.1). */
export function AgentDetail({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient()
  const town = useTown((s) => s.town)
  const view = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => api.agent({ params: { agentId } }),
    staleTime: 30_000,
  })
  const d = Details.safeParse(view.data).data
  const agent =
    town.agents[agentId] ?? Object.values(town.agents).find((a) => a.agentId.toLowerCase() === agentId.toLowerCase())
  const name = agent?.ensName ?? agent?.name ?? d?.name ?? agentId
  const currency: Currency = d?.currency ?? "EUR"
  const [editing, setEditing] = useState(false)
  const [maxText, setMaxText] = useState("")
  const [avoid, setAvoid] = useState(true)
  const patch = useMutation({
    mutationFn: (body: { paused?: boolean; mandate?: { maxPerUnit?: string; avoidNoShowSellers?: boolean } }) =>
      api.patchAgent({ params: { agentId }, body }),
    onSuccess: (next) => {
      queryClient.setQueryData(["agent", agentId], next)
      setEditing(false)
    },
  })
  const max = parseFloorInput(maxText)
  const lots = Object.values(town.lots)
  const bids = lots.flatMap((l) =>
    l.bidLog.filter((b) => b.agentId.toLowerCase() === agentId.toLowerCase()).map((b) => ({ lot: l, bid: b })),
  )
  const bought = lots.filter(
    (l) => l.settlement && l.bidLog.some((b) => b.agentId.toLowerCase() === agentId.toLowerCase()),
  )
  const m = d?.mandate

  return (
    <section aria-label={name} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold">{name}</h2>
        <span className={`rounded px-2 text-sm ${d?.paused ? "bg-amber-700" : "bg-emerald-800"}`}>
          {d?.paused ? "Paused" : "Active"}
        </span>
        <AddressLink address={agentId} />
        <Link className="ml-auto text-sky-300 underline" to={`/town?select=agent:${agentId}`}>
          Watch in town
        </Link>
      </div>
      {view.isError && <p role="alert">We could not load this buyer's settings.</p>}
      {d?.persona && <p className="text-slate-300">{d.persona}</p>}
      {m && (
        <div className="space-y-1 rounded bg-slate-900 p-3">
          <p>
            {(m.commodities ?? []).join(", ")}
            {m.maxPerUnit && ` up to ${formatMoney(BigInt(m.maxPerUnit), currency)} per unit`}
            {m.qty && ` · ${m.qty} units`}
            {m.minGrade && ` · grade ${m.minGrade} or better`}
            {m.place && ` · ${m.place}`}
          </p>
          {d?.budget && <p>Budget {formatMoney(BigInt(d.budget), currency)}</p>}
          <p className="text-sm text-slate-300">
            {m.avoidNoShowSellers === false ? "Buys from any seller" : "Avoids sellers with no-shows"}
          </p>
          <div className="flex gap-2 pt-2">
            <button
              className="rounded bg-slate-700 px-4 py-2"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ paused: !d?.paused })}
            >
              {d?.paused ? "Resume" : "Pause"}
            </button>
            {!editing && (
              <button
                className="rounded bg-slate-700 px-4 py-2"
                onClick={() => {
                  setMaxText(m.maxPerUnit ? asInput(m.maxPerUnit) : "")
                  setAvoid(m.avoidNoShowSellers !== false)
                  setEditing(true)
                }}
              >
                Edit
              </button>
            )}
          </div>
          {editing && (
            <div className="space-y-2 pt-2">
              <label className="block">
                Max price per unit
                <input
                  className="mt-1 w-full rounded bg-slate-800 p-2"
                  value={maxText}
                  onChange={(e) => setMaxText(e.target.value)}
                />
              </label>
              {!max.ok && <p className="text-sm text-amber-300">{max.error}</p>}
              <label className="block">
                <input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} /> Avoid sellers
                with no-shows
              </label>
              <button
                className="rounded bg-emerald-700 px-4 py-2 font-bold disabled:opacity-50"
                disabled={!max.ok || patch.isPending}
                onClick={() =>
                  max.ok && patch.mutate({ mandate: { maxPerUnit: max.value.toString(), avoidNoShowSellers: avoid } })
                }
              >
                Save
              </button>
            </div>
          )}
          {patch.isError && <p role="alert">We could not save that. Please try again.</p>}
        </div>
      )}
      {d?.families && (
        <section aria-label="Families" className="rounded bg-slate-900 p-3">
          <h3 className="font-bold">Families buying together</h3>
          <ul>
            {d.families.map((f) => (
              <li key={f.name}>
                {f.name} · {f.qty}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Decisions">
        <h3 className="font-bold">Decisions</h3>
        {(agent?.reasons ?? []).length === 0 && <p className="text-slate-300">No decisions yet.</p>}
        <ul className="list-disc pl-5">
          {[...(agent?.reasons ?? [])].reverse().map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
      <table className="w-full text-sm" aria-label="Bids">
        <caption className="text-left font-bold">Bids</caption>
        <thead>
          <tr className="text-left text-slate-300">
            <th>Lot</th>
            <th>Max</th>
            <th>Amount</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {bids.map(({ lot, bid }) => (
            <tr key={bid.tx}>
              <td>Lot {lot.lotId}</td>
              <td>{lotPerUnit(lot, bid.maxPerUnit)}</td>
              <td>{lotMoney(lot, bid.amount)}</td>
              <td>
                <TxLink tx={bid.tx} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section aria-label="Purchases">
        <h3 className="font-bold">Purchases and handovers</h3>
        {bought.length === 0 && <p className="text-slate-300">Nothing bought yet.</p>}
        <ul className="space-y-2">
          {bought.map((l) => (
            <Purchase key={l.lotId} lot={l} agentId={agentId} />
          ))}
        </ul>
      </section>
    </section>
  )
}
