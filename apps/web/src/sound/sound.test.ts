import { describe, expect, it } from "vitest"
import { loadMuted, saveMuted } from "./prefs"

class MemoryStorage {
  map = new Map<string, string>()
  getItem = (k: string) => this.map.get(k) ?? null
  setItem = (k: string, v: string) => void this.map.set(k, v)
}

describe("mute preference", () => {
  it("starts muted, because browsers block sound until a click", () => {
    expect(loadMuted(new MemoryStorage())).toBe(true)
  })

  it("remembers the choice", () => {
    const s = new MemoryStorage()
    saveMuted(false, s)
    expect(loadMuted(s)).toBe(false)
  })

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(loadMuted(broken)).toBe(true)
    expect(() => saveMuted(false, broken)).not.toThrow()
  })
})
