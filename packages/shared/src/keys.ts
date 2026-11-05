import { hexToString, stringToHex, type Hex } from "viem"

export const SECTORS = ["produce", "fish", "flowers", "truck", "storage", "compute"] as const
export const BUILDINGS = [
  "harvest_hall",
  "fish_dock",
  "flower_hall",
  "freight_yard",
  "cold_vault",
  "neighbourhood_pool",
  "compute_yard",
  "town_gate",
] as const
export const MARKET_OF_SECTOR = {
  produce: "harvest_hall",
  fish: "fish_dock",
  flowers: "flower_hall",
  truck: "freight_yard",
  storage: "cold_vault",
  compute: "compute_yard",
} as const
export const COMMODITIES = [
  "cod",
  "haddock",
  "tomato",
  "onion",
  "marigold",
  "rose",
  "truck_capacity",
  "cargo_slot",
  "storage_slot",
  "gpu_hour",
] as const
export const UNITS = {
  produce: "kg",
  fish: "kg",
  flowers: "kg",
  truck: "kg_route",
  storage: "slot_day",
  compute: "gpu_hour",
} as const
export const PLACES = [
  "bergen",
  "oslo",
  "hamburg",
  "dallas",
  "houston",
  "mumbai",
  "pune",
  "nairobi",
  "amsterdam",
  "lagos",
  "any_dc",
] as const
export const CURRENCIES = ["USD", "EUR", "USDC"] as const
export const DISPLAY_CURRENCIES = ["USD", "EUR", "NOK", "INR", "KES", "NGN"] as const
export const ROLES = { NONE: 0, SELLER: 1, BUYER: 2, TRUCK: 3, STORAGE: 4, SOCIETY: 5, HUMAN: 6 } as const
export const ROLE_NAMES = ["NONE", "SELLER", "BUYER", "TRUCK", "STORAGE", "SOCIETY", "HUMAN"] as const
export const SIGNAL_KINDS = ["weather", "festival", "demand_dip", "reference"] as const
export const GRADES = [
  "extra",
  "class_1",
  "class_2",
  "fresh_e",
  "fresh_a",
  "fresh_b",
  "unfit",
  "bloom_a",
  "bloom_b",
  "gpu_verified",
  "na",
] as const
export const LOT_STATUS = [
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
] as const

export const toKey = (s: string) => stringToHex(s, { size: 32 })
export const fromKey = (k: Hex) => hexToString(k, { size: 32 })

export type Sector = (typeof SECTORS)[number]
export type Building = (typeof BUILDINGS)[number]
export type Commodity = (typeof COMMODITIES)[number]
export type Place = (typeof PLACES)[number]
export type Currency = (typeof CURRENCIES)[number]
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]
export type Role = (typeof ROLE_NAMES)[number]
export type SignalKind = (typeof SIGNAL_KINDS)[number]
export type Grade = (typeof GRADES)[number]
export type LotStatus = (typeof LOT_STATUS)[number]
