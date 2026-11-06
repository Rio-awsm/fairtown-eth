import type { Role } from "@fairtown/shared/keys"
import type { MarketBuilding } from "../game/map/anchors"

/**
 * The town's two looks (D-122). Night: a neon city, dark ground, everything that matters glowing.
 * Day: the same city in sunlight, buildings pale, the neon kept as solid colour so it still reads.
 * The person watching picks one with the toggle; the replay's dawn and dusk no longer change it.
 */
export type Daylight = "night" | "day"

export type SceneLook = {
  sky: number
  hemiSky: number
  hemiGround: number
  hemi: number
  fill: number
  key: number
  keyColour: number
  exposure: number
  bloom: { strength: number; radius: number; threshold: number }
  /** Edge darkening, 0 (none) to 1 (black corners). */
  vignette: number
  /** Multiplies window glow: lit at night, off by day. */
  windows: number
  /** Multiplies the clay's colour: graphite at night, pale concrete by day. */
  clay: number
  /** Multiplies painted models (cars, people, boats). */
  paint: number
  /** Multiplies foliage colour. */
  leaves: number
  /** Neon brightness: above 1 blooms. */
  neon: number
  ground: number
  asphalt: number
  water: number
  /** Light pools under lamps and stalls; additive light vanishes on a bright ground. */
  pools: number
  /** Markers (beams, rings, pins) add light at night and are solid colour by day. */
  additive: boolean
}

export const LOOKS: Record<Daylight, SceneLook> = {
  night: {
    sky: 0x0a0b1e,
    hemiSky: 0x9aa2ff,
    hemiGround: 0x0b0e16,
    hemi: 0.95,
    fill: 0.6,
    key: 1.8,
    keyColour: 0xc8c8ff,
    exposure: 1.15,
    bloom: { strength: 1.05, radius: 0.55, threshold: 0.72 },
    vignette: 0.42,
    windows: 1,
    clay: 1,
    paint: 1,
    leaves: 1,
    neon: 2.4,
    ground: 0xffffff,
    asphalt: 0x15182a,
    water: 0x0c2342,
    pools: 1,
    additive: true,
  },
  day: {
    sky: 0x9cc6ec,
    hemiSky: 0xf2f6ff,
    hemiGround: 0x8a90a0,
    hemi: 1.6,
    fill: 0.8,
    key: 2.3,
    keyColour: 0xfff1dc,
    exposure: 0.98,
    bloom: { strength: 0.25, radius: 0.4, threshold: 0.92 },
    vignette: 0.14,
    windows: 0,
    clay: 1.9,
    paint: 1.4,
    leaves: 2.4,
    neon: 1.1,
    ground: 0xd5dbe6,
    asphalt: 0x3c4356,
    water: 0x3a7fc0,
    pools: 0,
    additive: false,
  },
}

/** Each market's own neon, on its outline, its sign and the legend. */
export const MARKET_NEON: Record<MarketBuilding, number> = {
  fish_dock: 0x00e5ff,
  flower_hall: 0xff3cac,
  harvest_hall: 0xb6ff3b,
  compute_yard: 0x9d6bff,
  freight_yard: 0xff9f1c,
  cold_vault: 0x7df9ff,
  neighbourhood_pool: 0xffe14d,
}

/** Who is who, by colour: AI agents are orbs with a beam; sellers, drivers and walk-ins are people with a pin. */
export const ROLE_COLOUR: Record<Role, number> = {
  BUYER: 0x00e5ff,
  STORAGE: 0x9d6bff,
  SOCIETY: 0xff3cac,
  NONE: 0xb6ff3b,
  SELLER: 0xff9f1c,
  TRUCK: 0xffe14d,
  HUMAN: 0x39ff88,
}

export const ROLE_WORD: Record<Role, string> = {
  BUYER: "AI buyer",
  STORAGE: "AI storage",
  SOCIETY: "AI society",
  NONE: "AI agent",
  SELLER: "Seller",
  TRUCK: "Driver",
  HUMAN: "Walk-in",
}

/** `0x00e5ff` → `"#00e5ff"`, for CSS. */
export const cssHex = (n: number) => `#${n.toString(16).padStart(6, "0")}`

type StorageLike = Pick<Storage, "getItem" | "setItem">
const KEY = "fairtown.daylight"

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Any stored value other than "day" means night: night is the town's own look. */
export function parseDaylight(raw: unknown): Daylight {
  return raw === "day" ? "day" : "night"
}

export function loadDaylight(storage: StorageLike | null = browserStorage()): Daylight {
  try {
    return parseDaylight(storage?.getItem(KEY))
  } catch {
    return "night"
  }
}

export function saveDaylight(daylight: Daylight, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, daylight)
  } catch (error: unknown) {
    console.warn("could not save the day or night setting", error)
  }
}
