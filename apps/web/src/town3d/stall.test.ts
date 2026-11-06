// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import type { TownCommand } from "../game/commands"
import { Clock } from "./clock"
import { Models } from "./models"
import { Stall3D } from "./stall"

const place = (slot: number | null = 1) =>
  ({
    kind: "placeStall",
    lotId: "12",
    building: "fish_dock",
    slot,
    commodity: "cod",
    qty: 600,
    unit: "kg",
    floorLabel: "€7.50/kg",
    seller: "0xseller",
    endBlock: 1100,
  }) as TownCommand & { kind: "placeStall" }

const card = (s: Stall3D) =>
  (s.group.children.find((c) => "element" in c) as unknown as { element: HTMLElement }).element
const text = (s: Stall3D, cls: string) => card(s).querySelector(`.${cls}`)!.textContent

describe("Stall3D", () => {
  it("shows the floor, Open and the countdown, and opens its lot when its card is clicked", () => {
    const select = vi.fn()
    const s = new Stall3D(new Clock(), new Models(), { x: 32, y: 32 }, place(), select)
    s.setClock(1070)
    expect(text(s, "ft-stall-price")).toBe("€7.50/kg")
    expect(text(s, "ft-stall-status")).toBe("Open")
    expect(text(s, "ft-stall-timer")).toMatch(/^ends in /)
    card(s).dispatchEvent(new Event("pointerdown"))
    expect(select).toHaveBeenCalledTimes(1)
    expect(s.hits.every((h) => h.userData.lotId === "12")).toBe(true)
  })
  it("takes the new status and price", () => {
    const s = new Stall3D(new Clock(), new Models(), { x: 0, y: 0 }, place(), () => {})
    s.setStatus("paid_in_full")
    expect(text(s, "ft-stall-status")).toBe("Paid in full")
    expect(card(s).dataset.status).toBe("paid_in_full")
    s.setPrice("€9.00/kg", 3, 1)
    expect(text(s, "ft-stall-price")).toBe("now €9.00/kg")
  })
  it("a no-show beats the seller's tier badge and stays after the refund", () => {
    const s = new Stall3D(new Clock(), new Models(), { x: 0, y: 0 }, place(), () => {})
    s.setTier("proven")
    expect(text(s, "ft-stall-badge")).toBe("Proven")
    s.markNoShow()
    s.setTier("proven")
    expect(text(s, "ft-stall-badge")).toBe("No-show")
    s.setStatus("refunded")
    expect(text(s, "ft-stall-status")).toBe("No-show")
  })
  it("the clearing beam rises and is gone afterwards", () => {
    const clock = new Clock()
    const s = new Stall3D(clock, new Models(), { x: 0, y: 0 }, place(), () => {})
    const before = s.group.children.length
    s.flash(1)
    expect(s.group.children.length).toBe(before + 1)
    clock.advance(2000)
    expect(s.group.children.length).toBe(before)
  })
})
