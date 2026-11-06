import { useEffect } from "react"
import { Link } from "react-router"
import { KEY_BUILDINGS } from "./keys"
import { townStore, useTown } from "../state/townStore"
import { saveMuted } from "../sound/prefs"
import { saveDaylight } from "../town3d/theme"
import { unlockAudio } from "../sound/sfx"
import { AgentPanel } from "./AgentPanel"
import { BuildingPanel } from "./BuildingPanel"
import { LotJourney } from "./LotJourney"
import { LotPanel } from "./LotPanel"
import { Ticker } from "./Ticker"
import { TopBar } from "./TopBar"
import { TownLegend } from "./TownLegend"
import { PriceWeatherToggle } from "./PriceWeatherToggle"
import { WalkinQr } from "./WalkinQr"
import { WorldClock } from "./WorldClock"

function Panel() {
  const selection = useTown((s) => s.selection)
  const select = useTown((s) => s.select)
  if (!selection) return null
  return (
    <aside
      aria-label="Details"
      className="rpg-window ft-hud-panel pointer-events-auto absolute top-20 right-4 bottom-20 w-96 overflow-auto p-5"
    >
      <button
        className="rpg-btn rpg-btn-quiet rpg-btn-sm float-right ml-2 min-w-8"
        onClick={() => select(null)}
        aria-label="Close"
      >
        ✕
      </button>
      {selection.kind === "lot" && <LotPanel lotId={selection.id} />}
      {selection.kind === "agent" && <AgentPanel agentId={selection.id} />}
      {selection.kind === "building" && <BuildingPanel building={selection.id} />}
    </aside>
  )
}

/**
 * HUD over the town, in the neon look (D-113, D-122): a bar across the top (LIVE or REPLAY, TEST
 * MONEY, block, relay, sound, day or night; the wordmark; two pills), the world clock and price
 * weather down the left, the join QR, the lot journey and the key, the ticker and the detail panel.
 */
export function HudLayer() {
  const select = useTown((s) => s.select)
  const selection = useTown((s) => s.selection)
  const qr = useTown((s) => s.ui.qr)
  const setUi = useTown((s) => s.setUi)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "Escape") return select(null)
      // Presenter keys (S3 5.1): D camera director, M sound, W price weather, N day or night.
      const ui = townStore.getState().ui
      if (e.key === "d") return setUi({ director: !ui.director })
      if (e.key === "n") {
        const daylight = ui.daylight === "day" ? "night" : "day"
        saveDaylight(daylight)
        return setUi({ daylight })
      }
      if (e.key === "w") return setUi({ priceWeather: !ui.priceWeather })
      if (e.key === "m") {
        if (ui.muted) unlockAudio()
        saveMuted(!ui.muted)
        return setUi({ muted: !ui.muted })
      }
      const n = Number(e.key)
      const building = Number.isInteger(n) ? KEY_BUILDINGS[n - 1] : undefined
      if (building) select({ kind: "building", id: building })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [select, setUi])
  return (
    <div className="ft-hud ft-skin pointer-events-none absolute inset-0">
      <header className="ft-hud-bar pointer-events-auto">
        <TopBar />
        <Link to="/" className="ft-hud-wordmark">
          FAIRTOWN
        </Link>
        <nav aria-label="Fairtown" className="ft-hud-pills">
          <Link to="/board" className="ft-pill ft-pill-grey">
            PUBLIC BOARD
          </Link>
          <Link to="/sell" className="ft-pill ft-pill-lime">
            SELL A LOT
          </Link>
        </nav>
      </header>
      <div className="ft-hud-left pointer-events-auto">
        <WorldClock />
        <PriceWeatherToggle />
      </div>
      <div className="ft-hud-qr pointer-events-auto">
        <WalkinQr shown={qr} onShownChange={(v) => setUi({ qr: v })} />
      </div>
      <div className="ft-hud-journey pointer-events-auto">
        <LotJourney />
      </div>
      {/* The key steps aside while a detail panel is open on the right. */}
      {!selection && (
        <div className="ft-hud-legend pointer-events-auto">
          <TownLegend />
        </div>
      )}
      <div className="pointer-events-auto absolute right-4 bottom-4 left-4">
        <Ticker />
      </div>
      <Panel />
    </div>
  )
}

export { KEY_BUILDINGS }
