import { useSearchParams } from "react-router"
import { env } from "../config"
import { PhaserGame } from "../game/PhaserGame"
import { DevOverlay } from "../hud/DevOverlay"
import { HudLayer } from "../hud/HudLayer"

export function TownPage() {
  const [params] = useSearchParams()
  const debug = env.exposeTown && params.get("debug") === "1"
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
