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
  if (health.isPending) return <span className="text-slate-300">Checking API…</span>
  if (health.isError) {
    const code = health.error instanceof ApiClientError ? health.error.code : "error"
    return <span className="text-red-400">API down ({code})</span>
  }
  return (
    <span className={health.data.ok ? "text-emerald-400" : "text-amber-400"}>
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
    <section aria-label="Scenarios" className="space-y-3 rounded bg-slate-900 p-4">
      <h2 className="text-xl font-bold">Scenarios</h2>
      <label className="block">
        Scenario speed
        <select
          className="ml-2 rounded bg-slate-800 p-1"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
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
            className="rounded bg-emerald-800 px-3 py-3 font-mono text-sm disabled:opacity-50"
            disabled={start.isPending}
            onClick={() => start.mutate(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {start.isSuccess && (
        <p className="text-emerald-300">
          Started {start.variables} at {speed}×
        </p>
      )}
      {start.isError && (
        <p role="alert" className="text-amber-300">
          Could not start {start.variables}. Is the agents service running?
        </p>
      )}
      <p className="text-slate-300">
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
        className={`rounded px-3 py-2 ${value ? "bg-sky-700" : "bg-slate-700"}`}
        onClick={() => send({ type: key, on: !value })}
      >
        {label}
      </button>
    )
  }
  const soundOn = ui ? !ui.muted : false
  return (
    <section aria-label="Town" className="space-y-3 rounded bg-slate-900 p-4">
      <h2 className="text-xl font-bold">Town</h2>
      <p className={town ? "text-emerald-300" : "text-amber-300"}>
        {town ? "Town window connected" : "Open /town in another window on this computer."}
      </p>
      <div className="flex flex-wrap gap-2">
        {toggle("Camera director", "director", false)}
        {toggle("Price weather", "priceWeather", false)}
        {toggle("Join QR", "qr", true)}
        {toggle("World clock focus", "clockFocus", false)}
        <button
          aria-pressed={soundOn}
          className={`rounded px-3 py-2 ${soundOn ? "bg-sky-700" : "bg-slate-700"}`}
          onClick={() => send({ type: "mute", on: soundOn })}
        >
          Sound
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {KEY_BUILDINGS.map((b) => (
          <button
            key={b}
            className="rounded bg-slate-800 px-2 py-2 text-left text-sm"
            onClick={() => send({ type: "jump", building: b })}
          >
            Jump to {BUILDING_SIGNS[b]}
          </button>
        ))}
      </div>
      <label className="block">
        Replay speed
        <select
          className="ml-2 rounded bg-slate-800 p-1"
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
      <p className="text-xs text-slate-300">
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
        <h1 className="text-2xl font-bold">Control</h1>
        <ApiHealth />
      </div>
      <Scenarios />
      <TownControls />
    </section>
  )
}
