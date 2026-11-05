import type { Building } from "@fairtown/shared/keys"
import { BUILDING_SIGNS } from "../game/map/buildings"
import { useTown } from "../state/townStore"
import { formatMoney } from "../money/format"
import { asCurrency, buildingSummary, lotPerUnit } from "./model"

export function BuildingPanel({ building }: { building: Building }) {
  const town = useTown((s) => s.town)
  const select = useTown((s) => s.select)
  const { open, clears, references } = buildingSummary(town, building)
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">{BUILDING_SIGNS[building]}</h2>
      <section aria-label="Open lots">
        <h3 className="text-xs text-slate-400">Open lots</h3>
        {open.length === 0 && <p className="text-sm text-slate-400">No open lots</p>}
        {open.map((l) => (
          <button key={l.lotId} className="block underline" onClick={() => select({ kind: "lot", id: l.lotId })}>
            Lot {l.lotId} · {l.commodity} · floor {lotPerUnit(l, l.floorPerUnit)}
          </button>
        ))}
      </section>
      <section aria-label="Recent clears">
        <h3 className="text-xs text-slate-400">Recent clears</h3>
        {clears.length === 0 && <p className="text-sm text-slate-400">No clears yet</p>}
        {clears.map((l) => (
          <button key={l.lotId} className="block underline" onClick={() => select({ kind: "lot", id: l.lotId })}>
            Lot {l.lotId} · {l.commodity} · avg {l.avgPerUnit ? lotPerUnit(l, l.avgPerUnit) : "—"}
          </button>
        ))}
      </section>
      <section aria-label="Reference">
        <h3 className="text-xs text-slate-400">Reference</h3>
        {references.length === 0 && <p className="text-sm text-slate-400">No reference yet</p>}
        {references.map((r) => {
          const c = asCurrency(r.currency)
          return (
            <p key={r.commodity} className="text-sm" title={`reference.updated from ${r.source}`}>
              {r.commodity} {c ? formatMoney(BigInt(r.perUnit), c) : r.perUnit}
            </p>
          )
        })}
      </section>
    </div>
  )
}
