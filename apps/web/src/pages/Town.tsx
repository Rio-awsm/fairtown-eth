import { useEffect } from "react"
import { useSearchParams } from "react-router"
import { parseSelectParam } from "../buy/model"
import { useTown } from "../state/townStore"
import { env } from "../config"
import { PhaserGame } from "../game/PhaserGame"
import { DevOverlay } from "../hud/DevOverlay"
import { HudLayer } from "../hud/HudLayer"

export function TownPage() {
  const [params] = useSearchParams()
  const debug = env.exposeTown && params.get("debug") === "1"
  const select = useTown((s) => s.select)
  const selectParam = params.get("select")
  // "Watch in town" (S3 3.1) arrives with ?select=agent:<id> and opens that panel.
  useEffect(() => {
    const selection = parseSelectParam(selectParam)
    if (selection) select(selection)
  }, [selectParam, select])
  return (
    <section className="relative h-screen w-full">
      <h1 className="sr-only">Town</h1>
      <PhaserGame className="h-screen w-full" />
      <div data-hud>
        <HudLayer />
      </div>
      {debug && <DevOverlay />}
    </section>
  )
}
