import { describe, expect, it, vi } from "vitest"
import { TOWN_FONTS, loadFonts } from "./fonts"

describe("loadFonts", () => {
  it("loads every town font", async () => {
    const load = vi.fn((font: string) => Promise.resolve([font]))
    await expect(loadFonts({ fonts: { load } })).resolves.toBe("loaded")
    expect(load.mock.calls.map((c) => c[0])).toEqual(TOWN_FONTS)
  })

  it("gives up after the timeout so a slow font never blocks the town", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const pending = loadFonts({ fonts: { load: () => new Promise(() => {}) } }, 500)
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBe("timeout")
    expect(warn).toHaveBeenCalled()
    vi.useRealTimers()
    warn.mockRestore()
  })

  it("reports a failed font load and carries on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(loadFonts({ fonts: { load: () => Promise.reject(new Error("404")) } })).resolves.toBe("failed")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("carries on without the font API", async () => {
    await expect(loadFonts({})).resolves.toBe("failed")
  })
})
