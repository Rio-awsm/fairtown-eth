import { describe, expect, it, vi } from "vitest"
import { MARKET_BUILDINGS } from "../game/map/anchors"
import { LOOKS, MARKET_NEON, ROLE_COLOUR, cssHex, loadDaylight, parseDaylight, saveDaylight } from "./theme"

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe("looks", () => {
  it("night adds light and lights the windows; day is solid colour with the windows off", () => {
    expect(LOOKS.night.additive).toBe(true)
    expect(LOOKS.night.windows).toBeGreaterThan(0)
    expect(LOOKS.day.additive).toBe(false)
    expect(LOOKS.day.windows).toBe(0)
    // Daylight is brighter clay and quieter bloom than night.
    expect(LOOKS.day.clay).toBeGreaterThan(LOOKS.night.clay)
    expect(LOOKS.day.bloom.strength).toBeLessThan(LOOKS.night.bloom.strength)
  })
  it("gives every market its own neon", () => {
    const colours = MARKET_BUILDINGS.map((b) => MARKET_NEON[b])
    expect(colours.every((c) => typeof c === "number")).toBe(true)
    expect(new Set(colours).size).toBe(MARKET_BUILDINGS.length)
  })
  it("tells sellers, drivers and walk-ins apart, and AI buyers, storage and society apart", () => {
    const people = [ROLE_COLOUR.SELLER, ROLE_COLOUR.TRUCK, ROLE_COLOUR.HUMAN]
    const agents = [ROLE_COLOUR.BUYER, ROLE_COLOUR.STORAGE, ROLE_COLOUR.SOCIETY]
    expect(new Set(people).size).toBe(3)
    expect(new Set(agents).size).toBe(3)
  })
  it("writes colours as CSS hex, padded", () => {
    expect(cssHex(0x00e5ff)).toBe("#00e5ff")
    expect(cssHex(0xff)).toBe("#0000ff")
  })
})

describe("daylight setting", () => {
  it("reads day only when day was saved; anything else is night", () => {
    expect(parseDaylight("day")).toBe("day")
    expect(parseDaylight("night")).toBe("night")
    expect(parseDaylight("noon")).toBe("night")
    expect(parseDaylight(null)).toBe("night")
  })
  it("round-trips through storage", () => {
    const s = memory()
    expect(loadDaylight(s)).toBe("night")
    saveDaylight("day", s)
    expect(loadDaylight(s)).toBe("day")
  })
  it("falls back to night when storage is missing or throws, and never throws on save", () => {
    expect(loadDaylight(null)).toBe("night")
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("full")
      },
    }
    expect(loadDaylight(broken)).toBe("night")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => saveDaylight("day", broken)).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
