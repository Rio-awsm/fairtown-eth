import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { z } from "zod"
import { countdown } from "../game/market/slots"
import type { AgentState, LotState } from "../game/reducer"
import { handoverParties, noShowReportable } from "../handover/model"
import { STATUS_WORDS } from "../hud/model"
import { api } from "../net/api"
import { useTown } from "../state/townStore"

const Winners = z.array(z.object({ buyer: z.string(), tokenAmount: z.string().regex(/^\d+$/) }))

function NoShow({ lot, buyer }: { lot: LotState; buyer: AgentState }) {
  const block = useTown((s) => s.town.block)
  const view = useQuery({ queryKey: ["lot", lot.lotId], queryFn: () => api.lot({ params: { lotId: lot.lotId } }) })
  const winners = Winners.safeParse((view.data as { winners?: unknown } | undefined)?.winners).data
  const mine = view.isPending
    ? undefined
    : handoverParties(lot, winners).find((p) => p.buyer.toLowerCase() === buyer.agentId.toLowerCase())
  const report = useMutation({
    mutationFn: () =>
      api.noshowReport({ body: { buyerId: buyer.agentId, lotId: lot.lotId, tokenAmount: mine!.tokenAmount } }),
  })
  if (report.isSuccess)
    return <p role="status">Reported. The seller has until block {report.data.contestEnds} to answer.</p>
  if (report.isError) return <p role="alert">We could not send the report. Please try again.</p>
  if (lot.deadlineBlock === undefined || !mine) return null
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

/** Buyer console. S3 2.2 adds the no-show report; S3 3.1 builds the rest. */
export function BuyPage() {
  const agents = useTown((s) => s.town.agents)
  const lots = useTown((s) => s.town.lots)
  const [buyer, setBuyer] = useState<AgentState | null>(null)
  const buyers = Object.values(agents).filter((a) => a.role === "BUYER" || a.role === "SOCIETY" || a.role === "HUMAN")
  const mine = buyer
    ? Object.values(lots).filter(
        (l) => l.settlement && l.bidLog.some((b) => b.agentId.toLowerCase() === buyer.agentId.toLowerCase()),
      )
    : []
  return (
    <section className="mx-auto max-w-2xl space-y-3 p-4">
      <h1 className="text-2xl font-bold">Buyer console</h1>
      {!buyer ? (
        <div className="space-y-2">
          <p className="text-slate-300">Which buyer are you?</p>
          {buyers.map((a) => (
            <button
              key={a.agentId}
              className="block w-full rounded bg-slate-800 p-3 text-left"
              onClick={() => setBuyer(a)}
            >
              {a.ensName ?? a.name}
            </button>
          ))}
        </div>
      ) : (
        <section aria-label="Your purchases" className="space-y-2">
          <p className="text-sm text-slate-300">Buying as {buyer.ensName ?? buyer.name}</p>
          {mine.length === 0 && <p>No purchases yet.</p>}
          {mine.map((l) => (
            <div key={l.lotId} className="space-y-1 rounded bg-slate-900 p-3">
              <p>
                Lot {l.lotId} · {l.qty} {l.unit} {l.commodity} from {l.sellerName} ·{" "}
                {STATUS_WORDS[l.status] ?? l.status}
              </p>
              <NoShow lot={l} buyer={buyer} />
            </div>
          ))}
        </section>
      )}
    </section>
  )
}
