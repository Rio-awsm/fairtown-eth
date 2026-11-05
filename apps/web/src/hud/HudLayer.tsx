import type { Building } from "@fairtown/shared/keys"
import { useEffect } from "react"
import { useTown } from "../state/townStore"
import { AgentPanel } from "./AgentPanel"
import { BuildingPanel } from "./BuildingPanel"
import { LotPanel } from "./LotPanel"
import { Ticker } from "./Ticker"
import { TopBar } from "./TopBar"
import { WalkinQr } from "./WalkinQr"
import { WorldClock } from "./WorldClock"

/** Keys 1 to 7 open the buildings in demo order (S3 1.4). */
export const KEY_BUILDINGS: readonly Building[] = [
  "fish_dock",
  "freight_yard",
  "flower_hall",
  "harvest_hall",
  "cold_vault",
  "neighbourhood_pool",
  "compute_yard",
]

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "Escape") return select(null)
      const n = Number(e.key)
      const building = Number.isInteger(n) ? KEY_BUILDINGS[n - 1] : undefined
      if (building) select({ kind: "building", id: building })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [select])
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute top-2 left-2 space-y-2">
        <TopBar />
        <WorldClock />
      </div>
      <div className="pointer-events-auto absolute bottom-12 left-2">
        <WalkinQr />
      </div>
      <div className="pointer-events-auto absolute right-2 bottom-2 left-2">
        <Ticker />
      </div>
      <Panel />
    </div>
  )
}
