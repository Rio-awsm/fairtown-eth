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
    <section aria-label="Your listing" className="rpg-window space-y-3 p-4">
      <div className="flex items-start justify-between">
        <h2 className="text-xl font-bold">
          {draft.qty} {draft.unit} {draft.commodity}
        </h2>
        <span className="rpg-badge bg-parchment-deep">{TIER[draft.payoutPreview.tier]}</span>
      </div>
      <p className="text-sm text-ink-soft">
        {draft.place} · Grade {draft.grade} · {Math.round(draft.gradeReport.confidence * 100)}% sure
      </p>
      <label className="block text-sm">
        <span className="block">
          Lowest price per {draft.unit} ({draft.currency})
        </span>
        <input
          className="rpg-input mt-2 w-full text-lg"
          inputMode="decimal"
          value={floorText}
          onChange={(e) => setFloorText(e.target.value)}
        />
      </label>
      {!floor.ok && <p className="text-sm text-gold-ink">{floor.error}</p>}
      <p className="text-xs text-ink-soft">
        We suggest {suggested}, a little under recent prices so buyers come quickly.
        {draft.reference &&
          ` Reference price ${formatMoney(BigInt(draft.reference.perUnit), draft.currency)} (${draft.reference.source}, ${draft.reference.date}).`}
      </p>
      {advice.data && <p className="text-sm text-harbour">{advice.data.advice}</p>}
      <p role="status" aria-label="What you will receive" className="rpg-well bg-meadow-tint p-3 text-sm">
        {preview}
      </p>
      <TestMoneyBadge />
      {error && (
        <p role="alert" className="text-sm text-gold-ink">
          {error}
        </p>
      )}
      <button
        className="rpg-btn rpg-btn-go w-full text-lg"
        disabled={!floor.ok || confirming}
        onClick={() => floor.ok && onConfirm(floor.value)}
      >
        Confirm and start selling
      </button>
    </section>
  )
}
