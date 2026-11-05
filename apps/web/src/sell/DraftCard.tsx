import type { LotDraft } from "@fairtown/shared/api"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import type { z } from "zod"
import { TestMoneyBadge } from "../hud/ModeBadge"
import { formatMoney, formatPerUnit, toDecimalString } from "../money/format"
import { api } from "../net/api"
import { parseFloorInput, previewPayout, previewText } from "./model"

type Draft = z.infer<typeof LotDraft>

/** "7500000" → "7.50": the floor as a seller would type it. */
const asInput = (base: string) =>
  toDecimalString(BigInt(base))
    .replace(/0+$/, "")
    .replace(/\.(\d)$/, ".$10")
    .replace(/\.$/, ".00")

const TIER = { new: "New seller", proven: "Proven seller", truck: "Truck" } as const

type Props = {
  draft: Draft
  sellerId: string
  confirming: boolean
  error: string | null
  onConfirm(floorPerUnit: bigint): void
}

/** The listing as the AI read it, the floor and why, and what the seller will receive, before Confirm (S3 2.1 key rule). */
export function DraftCard({ draft, sellerId, confirming, error, onConfirm }: Props) {
  const [floorText, setFloorText] = useState(() => asInput(draft.suggestedFloorPerUnit))
  const floor = parseFloorInput(floorText)
  const advice = useQuery({ queryKey: ["advice", sellerId], queryFn: () => api.sellerAdvice({ params: { sellerId } }) })
  const fx = useQuery({ queryKey: ["fx"], queryFn: () => api.fx() })
  const preview = useMemo(
    () =>
      floor.ok
        ? previewText(
            previewPayout({
              floorPerUnit: floor.value,
              qty: BigInt(draft.qty),
              advanceBps: draft.payoutPreview.advanceBps,
            }),
            draft.currency,
            draft.display?.currency,
            fx.data?.rates ?? {},
          )
        : null,
    [floor, draft, fx.data],
  )
  const suggested = formatPerUnit(BigInt(draft.suggestedFloorPerUnit), draft.currency, draft.unit)
  return (
    <section aria-label="Your listing" className="space-y-3 rounded bg-slate-900 p-3">
      <div className="flex items-start justify-between">
        <h2 className="text-xl font-bold">
          {draft.qty} {draft.unit} {draft.commodity}
        </h2>
        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{TIER[draft.payoutPreview.tier]}</span>
      </div>
      <p className="text-sm text-slate-300">
        {draft.place} · Grade {draft.grade} · {Math.round(draft.gradeReport.confidence * 100)}% sure
      </p>
      <label className="block text-sm">
        <span className="block">
          Lowest price per {draft.unit} ({draft.currency})
        </span>
        <input
          className="mt-1 w-full rounded bg-slate-800 p-3 text-lg"
          inputMode="decimal"
          value={floorText}
          onChange={(e) => setFloorText(e.target.value)}
        />
      </label>
      {!floor.ok && <p className="text-sm text-amber-300">{floor.error}</p>}
      <p className="text-xs text-slate-300">
        We suggest {suggested}, a little under recent prices so buyers come quickly.
        {draft.reference &&
          ` Reference price ${formatMoney(BigInt(draft.reference.perUnit), draft.currency)} (${draft.reference.source}, ${draft.reference.date}).`}
      </p>
      {advice.data && <p className="text-sm text-sky-200">{advice.data.advice}</p>}
      <p role="status" aria-label="What you will receive" className="rounded bg-emerald-950 p-2 text-sm">
        {preview}
      </p>
      <TestMoneyBadge />
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      <button
        className="w-full rounded bg-emerald-700 py-3 text-lg font-bold disabled:opacity-50"
        disabled={!floor.ok || confirming}
        onClick={() => floor.ok && onConfirm(floor.value)}
      >
        Confirm and start selling
      </button>
    </section>
  )
}
