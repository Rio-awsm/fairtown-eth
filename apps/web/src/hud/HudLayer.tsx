import { useEffect } from "react"
import { KEY_BUILDINGS } from "./keys"
import { townStore, useTown } from "../state/townStore"
import { saveMuted } from "../sound/prefs"
import { unlockAudio } from "../sound/sfx"
import { AgentPanel } from "./AgentPanel"
import { BuildingPanel } from "./BuildingPanel"
import { LotPanel } from "./LotPanel"
import { Ticker } from "./Ticker"
import { TopBar } from "./TopBar"
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
      className="pointer-events-auto absolute top-2 right-2 bottom-12 w-96 overflow-auto rounded bg-slate-900/95 p-3"
    >
      <button className="float-right text-slate-400" onClick={() => select(null)} aria-label="Close">
        ✕
      </button>
      {selection.kind === "lot" && <LotPanel lotId={selection.id} />}
      {selection.kind === "agent" && <AgentPanel agentId={selection.id} />}
      {selection.kind === "building" && <BuildingPanel building={selection.id} />}
    </aside>
  )
}

/** HUD over the town: top bar, world clock, ticker and the detail panel. */
export function HudLayer() {
  const select = useTown((s) => s.select)
  const qr = useTown((s) => s.ui.qr)
  const setUi = useTown((s) => s.setUi)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "Escape") return select(null)
      // Presenter keys (S3 5.1): D camera director, M sound, W price weather.
      const ui = townStore.getState().ui
      if (e.key === "d") return setUi({ director: !ui.director })
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
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute top-2 left-2 space-y-2">
        <TopBar />
        <WorldClock />
        <PriceWeatherToggle />
      </div>
      <div className="pointer-events-auto absolute bottom-12 left-2">
        <WalkinQr shown={qr} onShownChange={(v) => setUi({ qr: v })} />
      </div>
      <div className="pointer-events-auto absolute right-2 bottom-2 left-2">
        <Ticker />
      </div>
      <Panel />
    </div>
  )
}

export { KEY_BUILDINGS }
