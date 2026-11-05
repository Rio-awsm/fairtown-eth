import { useSearchParams } from "react-router"
import { env } from "../config"
import { PhaserGame } from "../game/PhaserGame"
import { DevOverlay } from "../hud/DevOverlay"

export function TownPage() {
  const [params] = useSearchParams()
  const debug = env.exposeTown && params.get("debug") === "1"
  return (
    <section className="relative">
      <h1 className="sr-only">Town</h1>
      <PhaserGame />
      {debug && <DevOverlay />}
    </section>
  )
}
