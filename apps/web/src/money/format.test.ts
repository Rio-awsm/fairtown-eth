import { describe, expect, it } from "vitest"
import { formatApprox, formatBps, formatMoney, formatPerUnit, toDecimalString } from "./format"

// Intl puts no-break and narrow no-break spaces in some locales; compare with plain spaces.
const plain = (s: string | null) => s?.replace(/[\u00a0\u202f]/g, " ") ?? null

describe("toDecimalString", () => {
  it("renders 6-decimal base units exactly", () => {
    expect(toDecimalString(2_702_700_000n)).toBe("2702.700000")
  })

  it("pads small values", () => {
    expect(toDecimalString(1n)).toBe("0.000001")
    expect(toDecimalString(0n)).toBe("0.000000")
  })
})

describe("formatMoney", () => {
  it("formats EUR from the Bergen cod sale", () => {
    expect(plain(formatMoney(2_702_700_000n, "EUR"))).toBe("€2,702.70")
  })

  it("formats USD", () => {
    expect(plain(formatMoney(5_460_000_000n, "USD"))).toBe("$5,460.00")
  })

  it("formats USDC, which is not an ISO currency code", () => {
    expect(plain(formatMoney(12_500_000n, "USDC"))).toBe("USDC 12.50")
  })

  it("keeps every digit above 2^53 base units", () => {
    expect(plain(formatMoney(9_007_199_254_740_993_000_000n, "USD"))).toBe("$9,007,199,254,740,993.00")
  })

  it("uses a caller locale such as Norwegian grouping", () => {
    expect(plain(formatMoney(31_800_000_000n, "EUR", { locale: "nb-NO" }))).toBe("31 800,00 €")
  })
})

describe("formatPerUnit", () => {
  it("formats a floor per kg", () => {
    expect(plain(formatPerUnit(7_500_000n, "EUR", "kg"))).toBe("€7.50/kg")
  })

  it("keeps sub-cent floors down to the product minimum of 0.001", () => {
    expect(plain(formatPerUnit(1_000n, "USD", "kg"))).toBe("$0.001/kg")
  })
})

describe("formatApprox", () => {
  const fx = { EUR: 0.92, INR: 84, NOK: 10.83 }

  it("shows rupees with lakh grouping, labelled approximate", () => {
    expect(plain(formatApprox(2_702_700_000n, "EUR", "INR", fx))).toBe("about INR 2,46,768")
  })

  it("shows kroner", () => {
    expect(plain(formatApprox(2_702_700_000n, "EUR", "NOK", fx))).toBe("about NOK 31,815")
  })

  it("treats USD as the base when the rate table omits it", () => {
    expect(plain(formatApprox(10_000_000n, "USD", "INR", fx))).toBe("about INR 840")
  })

  it("returns null when a rate is missing", () => {
    expect(formatApprox(2_702_700_000n, "EUR", "KES", fx)).toBeNull()
  })
})

describe("formatBps", () => {
  it("formats basis points as a percentage", () => {
    expect(formatBps(5000)).toBe("50%")
    expect(formatBps(2500)).toBe("25%")
    expect(formatBps(150)).toBe("1.5%")
  })
})
