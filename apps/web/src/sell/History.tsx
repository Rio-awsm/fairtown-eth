import { CURRENCIES, type Currency } from "@fairtown/shared/keys"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { STATUS_WORDS } from "../hud/model"
import { formatMoney } from "../money/format"
import { api } from "../net/api"

const Dec = z.string().regex(/^\d+$/)
const HistoryLot = z.looseObject({
  lotId: Dec,
  commodity: z.string(),
  qty: z.string(),
  unit: z.string(),
  status: z.string(),
})
const HistoryPayout = z.looseObject({ lotId: Dec, kind: z.string(), amount: Dec, currency: z.enum(CURRENCIES) })
const KIND = { at_sale: "at sale", at_handover: "at handover", refund: "refunded" } as Record<string, string>

/** Past lots and payouts from GET /api/sellers/:sellerId. Rows the page cannot read are skipped. */
export function History({ sellerId }: { sellerId: string }) {
  const profile = useQuery({ queryKey: ["seller", sellerId], queryFn: () => api.seller({ params: { sellerId } }) })
  if (profile.isPending) return <p>Loading your history…</p>
  if (profile.isError) return <p role="alert">We could not load your history. Please try again.</p>
  const lots = profile.data.lots.flatMap((l) => HistoryLot.safeParse(l).data ?? [])
  const payouts = profile.data.payouts.flatMap((p) => HistoryPayout.safeParse(p).data ?? [])
  return (
    <section aria-label="History" className="space-y-3">
      <ul className="space-y-1">
        {lots.map((l) => (
          <li key={l.lotId} className="rpg-window p-3">
            Lot {l.lotId} · {l.qty} {l.unit} {l.commodity} · {STATUS_WORDS[l.status] ?? l.status}
          </li>
        ))}
      </ul>
      <ul className="space-y-1">
        {payouts.map((p, i) => (
          <li key={i} className="text-sm">
            {formatMoney(BigInt(p.amount), p.currency as Currency)} {KIND[p.kind] ?? p.kind} · Lot {p.lotId}
          </li>
        ))}
      </ul>
      {lots.length === 0 && <p className="text-ink-soft">Nothing sold yet.</p>}
    </section>
  )
}
