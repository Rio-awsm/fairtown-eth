import { BUILDING_SIGNS } from "../game/map/buildings"
import { splitSign } from "../game/scenes/layout"
import { commodityLabel, unitLabel } from "../money/format"
import { useTown } from "../state/townStore"
import { journeySteps, spotlightLot } from "./journey"

/**
 * One lot's journey along the bottom of the town (D-122): where it is sold, and what happens to it
 * after, step by step, the current step glowing. Follows the selected lot, else the newest live one.
 */
export function LotJourney() {
  const lots = useTown((s) => s.town.lots)
  const selection = useTown((s) => s.selection)
  const select = useTown((s) => s.select)
  const id = spotlightLot(lots, selection)
  const lot = id ? lots[id] : undefined
  if (!lot) return null
  const steps = journeySteps(lot)
  const place = splitSign(BUILDING_SIGNS[lot.building]).title
  return (
    <section aria-label="Lot journey" className="rpg-window ft-journey">
      <button type="button" className="ft-journey-head" onClick={() => select({ kind: "lot", id: lot.lotId })}>
        <span className="ft-journey-lot">Lot {lot.lotId}</span>
        <span>
          {lot.qty} {unitLabel(lot.unit)} {commodityLabel(lot.commodity)}
        </span>
        <span className="ft-journey-place">{place}</span>
      </button>
      <ol className="ft-journey-steps">
        {steps.map((s) => (
          <li key={s.name} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span aria-hidden="true" className="ft-journey-dot" />
            <span className="ft-journey-name">{s.name}</span>
            {s.note && <span className="ft-journey-note">{s.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
