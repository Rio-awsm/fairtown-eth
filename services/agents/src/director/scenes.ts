import { toBase } from "@fairtown/shared"
import type { SignalInput } from "../chain/types"
import type { SectorEngine } from "../sectors/engine"

export const SCENE_NAMES = ["bergen_cod", "dallas_return", "gpu_night", "diwali_marigold", "rose_flight", "lagos_cold", "no_show"] as const
export type SceneName = (typeof SCENE_NAMES)[number]
export type ScenarioName = SceneName | "full_day"

export type SceneCtx = {
  engine: SectorEngine
  signal: (s: Omit<SignalInput, "expiresAtBlock">) => Promise<void>
  calendarLabel: (name: string, market: string) => string
}
export type SceneStep = { at: number; label: string; run: (c: SceneCtx) => Promise<unknown> }

// Forced signals always say so (guide rule). Calendar ones are labelled from festivals.json and today's date.
const forced = (label: string) => `${label} (forced)`

export const SCENES: Record<SceneName, SceneStep[]> = {
  bergen_cod: [
    { at: 0, label: "Storm signal, Bergen", run: (c) => c.signal({ kind: "weather", place: "bergen", severity: 4, label: forced("Storm forecast, Bergen") }) },
    {
      at: 10,
      label: "Ingrid lists 600 kg cod",
      run: (c) => c.engine.listFor("ingrid", { sector: "fish", market: "fish_dock", commodity: "cod", grade: "fresh_a", place: "bergen", currency: "EUR", qty: 600n, floorPerUnit: toBase("7.50") }, "600 kg cod, landed 04:40"),
    },
  ],
  dallas_return: [{ at: 0, label: "Maya lists 18,000 kg Dallas to Houston", run: (c) => c.engine.listCapacity("maya", 18000n, toBase("0.05"), "dallas") }],
  gpu_night: [{ at: 0, label: "Northlight lists 200 GPU hours", run: (c) => c.engine.listCompute("northlight", 200n, toBase("1.80")) }],
  diwali_marigold: [
    { at: 0, label: "Diwali signal, Mumbai", run: (c) => c.signal({ kind: "festival", place: "mumbai", severity: 5, label: c.calendarLabel("Diwali", "mumbai") }) },
    {
      at: 10,
      label: "Ganesh lists 2 tonnes of marigolds",
      run: (c) => c.engine.listFor("ganesh", { sector: "flowers", market: "flower_hall", commodity: "marigold", grade: "class_1", place: "pune", currency: "USD", qty: 2000n, floorPerUnit: toBase("0.90") }, "2 tonnes of marigolds for Diwali"),
    },
  ],
  rose_flight: [
    { at: 0, label: "Valentine's signal, Nairobi", run: (c) => c.signal({ kind: "festival", place: "nairobi", severity: 4, label: forced("Valentine's cargo cutoff") }) },
    {
      at: 10,
      label: "Wanjiru lists 1,000 kg roses",
      run: (c) => c.engine.listFor("wanjiru", { sector: "flowers", market: "flower_hall", commodity: "rose", grade: "bloom_a", place: "nairobi", currency: "EUR", qty: 1000n, floorPerUnit: toBase("4.00") }, "1,000 kg roses for the Amsterdam flight"),
    },
  ],
  lagos_cold: [
    { at: 0, label: "Glut signal, Lagos", run: (c) => c.signal({ kind: "demand_dip", place: "lagos", severity: 3, label: forced("Glut at Mile 12") }) },
    {
      at: 10,
      label: "Amina lists 3 tonnes of tomatoes",
      run: (c) => c.engine.listFor("amina", { sector: "produce", market: "harvest_hall", commodity: "tomato", grade: "class_1", place: "lagos", currency: "USD", qty: 3000n, floorPerUnit: toBase("0.40") }, "3 tonnes of tomatoes, glut at Mile 12"),
    },
  ],
  no_show: [
    {
      at: 0,
      label: "Coastal Catch lists 400 kg haddock",
      run: (c) => c.engine.listFor("coastal_catch", { sector: "fish", market: "fish_dock", commodity: "haddock", grade: "fresh_a", place: "bergen", currency: "EUR", qty: 400n, floorPerUnit: toBase("6.00") }, "400 kg haddock"),
    },
  ],
}

export const FULL_DAY_GAP = 120 // director blocks between scenes, divided by speed

export function stepsFor(name: ScenarioName): Array<SceneStep & { scene: SceneName }> {
  if (name !== "full_day") return SCENES[name].map((s) => ({ ...s, scene: name }))
  return SCENE_NAMES.flatMap((scene, i) => SCENES[scene].map((s) => ({ ...s, at: s.at + i * FULL_DAY_GAP, scene })))
}
