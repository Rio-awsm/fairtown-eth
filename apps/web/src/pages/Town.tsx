import { useEffect } from "react"
import { useSearchParams } from "react-router"
import { parseSelectParam } from "../buy/model"
import { useTown, townStore } from "../state/townStore"
import { openControlChannel } from "../control/channel"
import { EventBus } from "../game/EventBus"
import { attachSound } from "../sound/sfx"
import { saveMuted } from "../sound/prefs"
import { replaySpeed, setReplaySpeed } from "../state/activeRelay"
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
  useEffect(() => attachSound(EventBus, townStore), [])
  // /control in another window drives the town over a BroadcastChannel (S3 5.1).
  useEffect(() => {
    const state = () => ({ type: "state" as const, ui: townStore.getState().ui, speed: replaySpeed() })
    const channel = openControlChannel((msg) => {
      const setUi = townStore.getState().setUi
      if (msg.type === "hello") return channel.post(state())
      if (msg.type === "jump") return EventBus.emit("camera:jump", msg.building)
      if (msg.type === "speed") {
        setReplaySpeed(msg.speed)
        return channel.post(state())
      }
      if (msg.type === "mute") saveMuted(msg.on)
      if (msg.type === "director" || msg.type === "priceWeather" || msg.type === "qr" || msg.type === "clockFocus")
        setUi({ [msg.type]: msg.on })
      if (msg.type === "mute") setUi({ muted: msg.on })
    })
    const off = townStore.subscribe((s, prev) => {
      if (s.ui !== prev.ui) channel.post(state())
    })
    channel.post(state())
    return () => {
      off()
      channel.close()
    }
  }, [])
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
