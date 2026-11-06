import { describe, expect, it } from "vitest"
import { DEMO_SELLERS, newLotCode, parseFloorInput, previewPayout, previewText, voiceMode } from "./model"

describe("previewPayout", () => {
  it("splits the floor-price minimum with the 1% fee and the seller's advance", () => {
    expect(previewPayout({ floorPerUnit: 7_500_000n, qty: 600n, advanceBps: 5000 })).toEqual({
      raised: 4_500_000_000n,
      fee: 45_000_000n,
      atSale: 2_227_500_000n,
      atHandover: 2_227_500_000n,
    })
  })

  it("pays a proven seller 90% at sale", () => {
    expect(previewPayout({ floorPerUnit: 7_500_000n, qty: 600n, advanceBps: 9000 }).atSale).toBe(4_009_500_000n)
  })

  it("never uses floating point for money", () => {
    const big = previewPayout({ floorPerUnit: 999_999_999_999n, qty: 9_000_000n, advanceBps: 5000 })
    expect(big.atSale + big.atHandover + big.fee).toBe(big.raised)
  })
})

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ")

describe("previewText", () => {
  const p = previewPayout({ floorPerUnit: 7_500_000n, qty: 600n, advanceBps: 5000 })

  it("says the minimum at sale, the approximate local amount and the rest at handover", () => {
    expect(plain(previewText(p, "EUR", "NOK", { EUR: 0.92, NOK: 10.83 }))).toBe(
      "At least €2,227.50 at sale, about NOK 26,222, and the rest at handover.",
    )
  })

  it("leaves out the local amount when there is no rate or no display currency", () => {
    expect(previewText(p, "EUR", "NOK", {})).toBe("At least €2,227.50 at sale, and the rest at handover.")
    expect(previewText(p, "EUR", undefined, { EUR: 0.92 })).toBe(
      "At least €2,227.50 at sale, and the rest at handover.",
    )
  })
})

describe("parseFloorInput", () => {
  it.each([
    ["7.50", 7_500_000n],
    ["7,50", 7_500_000n],
    [" 12 ", 12_000_000n],
    ["0.001", 1_000n],
  ])("reads %s", (input, base) => {
    expect(parseFloorInput(input)).toEqual({ ok: true, value: base })
  })

  it.each([
    ["", "Enter a price"],
    ["abc", "Enter a price like 7.50"],
    ["-1", "Enter a price like 7.50"],
    ["0.0001", "The lowest price is 0.001"],
    ["1.1234567", "Use at most 6 decimals"],
  ])("rejects %s", (input, message) => {
    expect(parseFloorInput(input)).toEqual({ ok: false, error: message })
  })
})

describe("voiceMode", () => {
  it("prefers browser speech", () => {
    expect(voiceMode({ webkitSpeechRecognition: class {}, MediaRecorder: class {} })).toBe("speech")
    expect(voiceMode({ SpeechRecognition: class {} })).toBe("speech")
  })

  it("falls back to recording for the server", () => {
    expect(voiceMode({ MediaRecorder: class {} })).toBe("record")
  })

  it("hides the mic when neither exists", () => {
    expect(voiceMode({})).toBe("none")
  })
})

describe("newLotCode", () => {
  it("is always 4 digits", () => {
    expect(newLotCode(() => 0)).toBe("0000")
    expect(newLotCode(() => 0.0427)).toBe("0427")
    expect(newLotCode(() => 0.99999)).toBe("9999")
  })
})

describe("DEMO_SELLERS", () => {
  it("includes Ingrid, Maya, Ganesh and Northlight", () => {
    expect(DEMO_SELLERS.map((s) => s.id)).toEqual(expect.arrayContaining(["ingrid", "maya", "ganesh", "northlight"]))
  })
})
