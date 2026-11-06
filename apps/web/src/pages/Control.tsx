import { SCENARIOS } from "@fairtown/shared/api"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { openControlChannel, type ControlChannel, type ControlMessage } from "../control/channel"
import { BUILDING_SIGNS } from "../game/map/buildings"
import { KEY_BUILDINGS } from "../hud/keys"
import { api } from "../net/api"
import { ApiClientError } from "../net/apiClient"

type TownState = Extract<ControlMessage, { type: "state" }>
const SPEEDS = [1, 2, 5, 10, 20, 50]

function ApiHealth() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.health() })
  if (health.isPending) return <span className="rpg-badge bg-parchment">Checking API…</span>
  if (health.isError) {
    const code = health.error instanceof ApiClientError ? health.error.code : "error"
    return <span className="rpg-badge bg-brick text-parchment-light">API down ({code})</span>
  }
  return (
    <span className={`rpg-badge ${health.data.ok ? "bg-meadow-tint" : "bg-coin"}`}>
      {health.data.ok ? "API ok" : "API degraded"}
    </span>
  )
}

function Scenarios() {
  const [speed, setSpeed] = useState(10)
  const status = useQuery({
    queryKey: ["director-status"],
    queryFn: () => api.directorStatus(),
    refetchInterval: 2_000,
  })
  const start = useMutation({
    mutationFn: (name: (typeof SCENARIOS)[number]) => api.directorScenario({ body: { name, speed } }),
  })
  return (
    <section aria-label="Scenarios" className="rpg-window space-y-3 p-5">
      <h2 className="text-xl font-bold">Scenarios</h2>
      <label className="block">
        Scenario speed
        <select className="rpg-input ml-2 min-h-0 p-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {SCENARIOS.map((name) => (
          <button
            key={name}
            aria-label={`Start ${name}`}
            className="rpg-btn rpg-btn-go text-sm"
            disabled={start.isPending}
            onClick={() => start.mutate(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {start.isSuccess && (
        <p className="text-moss-ink">
          Started {start.variables} at {speed}×
        </p>
      )}
      {start.isError && (
        <p role="alert" className="text-gold-ink">
          Could not start {start.variables}. Is the agents service running?
        </p>
      )}
      <p className="text-ink-soft">
        {status.data?.scenario
          ? `Running ${status.data.scenario}${status.data.step ? ` · ${status.data.step}` : ""}`
          : "Nothing running"}
      </p>
    </section>
  )
}

function TownControls() {
  const channel = useRef<ControlChannel | null>(null)
  const [town, setTown] = useState<TownState | null>(null)
  useEffect(() => {
    const c = openControlChannel((msg) => msg.type === "state" && setTown(msg))
    channel.current = c
    c.post({ type: "hello" })
    return () => c.close()
  }, [])
  const send = (msg: ControlMessage) => channel.current?.post(msg)
  const ui = town?.ui
  const toggle = (label: string, key: "director" | "priceWeather" | "qr" | "clockFocus", fallback: boolean) => {
    const value = ui ? ui[key] : fallback
    return (
      <button
        aria-pressed={value}
        className={`rpg-btn ${value ? "rpg-btn-info" : "rpg-btn-quiet"}`}
        onClick={() => send({ type: key, on: !value })}
      >
        {label}
      </button>
    )
  }
  const soundOn = ui ? !ui.muted : false
  return (
    <section aria-label="Town" className="rpg-window space-y-3 p-5">
      <h2 className="text-xl font-bold">Town</h2>
      <p className={town ? "text-moss-ink" : "text-gold-ink"}>
        {town ? "Town window connected" : "Open /town in another window on this computer."}
      </p>
      <div className="flex flex-wrap gap-2">
        {toggle("Camera director", "director", false)}
        {toggle("Price weather", "priceWeather", false)}
        {toggle("Join QR", "qr", true)}
        {toggle("World clock focus", "clockFocus", false)}
        <button
          aria-pressed={soundOn}
          className={`rpg-btn ${soundOn ? "rpg-btn-info" : "rpg-btn-quiet"}`}
          onClick={() => send({ type: "mute", on: soundOn })}
        >
          Sound
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {KEY_BUILDINGS.map((b) => (
          <button
            key={b}
            className="rpg-window rpg-card px-3 py-2 text-sm"
            onClick={() => send({ type: "jump", building: b })}
          >
            Jump to {BUILDING_SIGNS[b]}
          </button>
        ))}
      </div>
      <label className="block">
        Replay speed
        <select
          className="rpg-input ml-2 min-h-0 p-1"
          value={town?.speed ?? 1}
          onChange={(e) => send({ type: "speed", speed: Number(e.target.value) })}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-ink-soft">
        Keys on the town screen: D director, W price weather, M sound, 1 to 7 buildings, Esc close.
      </p>
    </section>
  )
}

/** Presenter control (S3 5.1): scenarios through the API, town controls over a BroadcastChannel. */
export function ControlPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center gap-3">
        <h1 className="rpg-banner">Control</h1>
        <ApiHealth />
      </div>
      <Scenarios />
      <TownControls />
    </section>
  )
}
