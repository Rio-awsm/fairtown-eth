import { describe, expect, it } from "vitest"
import {
  BUILDINGS,
  COMMODITIES,
  CURRENCIES,
  DISPLAY_CURRENCIES,
  fromKey,
  GRADES,
  LOT_STATUS,
  MARKET_OF_SECTOR,
  PLACES,
  ROLE_NAMES,
  ROLES,
  SECTORS,
  SIGNAL_KINDS,
  toKey,
  UNITS,
} from "../src/keys"

const ALL = [
  ...SECTORS,
  ...BUILDINGS,
  ...COMMODITIES,
  ...PLACES,
  ...CURRENCIES,
  ...DISPLAY_CURRENCIES,
  ...SIGNAL_KINDS,
  ...GRADES,
  ...LOT_STATUS,
]

describe("toKey / fromKey", () => {
  it("round-trips every enum value through bytes32", () => {
    for (const v of ALL) {
      const k = toKey(v)
      expect(k).toMatch(/^0x[0-9a-f]{64}$/)
      expect(fromKey(k)).toBe(v)
    }
  })
  it("rejects strings longer than 32 bytes", () => {
    expect(() => toKey("x".repeat(33))).toThrow()
  })
})

describe("enum tables", () => {
  it("every sector has a market building and a unit", () => {
    for (const s of SECTORS) {
      expect(BUILDINGS).toContain(MARKET_OF_SECTOR[s])
      expect(UNITS[s]).toBeTruthy()
    }
  })
  it("ROLES numbers match the contract", () => {
    expect(ROLES).toEqual({ NONE: 0, SELLER: 1, BUYER: 2, TRUCK: 3, STORAGE: 4, SOCIETY: 5, HUMAN: 6 })
  })
  it("ROLE_NAMES matches ROLES keys", () => {
    expect([...ROLE_NAMES]).toEqual(Object.keys(ROLES))
  })
  it("LOT_STATUS order is locked, because statusOf() returns an index into it", () => {
    expect(LOT_STATUS).toEqual([
      "open",
      "unsold",
      "sold",
      "truck_booked",
      "picked_up",
      "paid_in_full",
      "delivered",
      "no_show_reported",
      "disputed",
      "refunded",
      "relisted",
    ])
  })
})
