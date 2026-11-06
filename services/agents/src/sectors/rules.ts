import type { Commodity, Currency, Sector } from "@fairtown/shared"
import type { Address } from "viem"

// D-50 (S2 owns auction durations): blocks at ~200 ms. Fake mode mines one block every 2 s, so it uses the D-12 values.
export const AUCTION_BLOCKS: Record<Sector, bigint> = { fish: 450n, flowers: 600n, produce: 900n, truck: 300n, storage: 300n, compute: 300n }
export const AUCTION_BLOCKS_FAKE: Record<Sector, bigint> = { fish: 45n, flowers: 60n, produce: 90n, truck: 30n, storage: 30n, compute: 30n }
export const PICKUP_BLOCKS: Record<Sector, bigint> = { fish: 3000n, flowers: 3000n, produce: 4500n, truck: 3000n, storage: 1500n, compute: 600n }

export type SectorRules = {
  auctionBlocks: Record<Sector, bigint>
  pickupBlocks: Record<Sector, bigint>
  relistStepBps: number
  relistMinBps: number // of the first floor
  maxRelists: number
  dutyMaxBps: number // a parent buyer pays up to floor x this for its own truck or storage lot
  slotKg: bigint
  storageDays: number
  arriveBlocks: bigint // receiver walks over
  travelBlocks: bigint // truck drives to the drop-off
  capacityFloor: Record<Currency, bigint> // per kg_route when there is no reference
  storageFloor: Record<Currency, bigint> // per slot_day
}

// D-67
export const DEFAULT_RULES: SectorRules = {
  auctionBlocks: AUCTION_BLOCKS,
  pickupBlocks: PICKUP_BLOCKS,
  relistStepBps: 1500,
  relistMinBps: 6000,
  maxRelists: 3,
  dutyMaxBps: 15000,
  slotKg: 1000n,
  storageDays: 2,
  arriveBlocks: 25n,
  travelBlocks: 100n,
  capacityFloor: { EUR: 800_000n, USD: 50_000n, USDC: 50_000n },
  storageFloor: { EUR: 5_000_000n, USD: 5_000_000n, USDC: 5_000_000n },
}

export const GOODS: readonly Sector[] = ["fish", "flowers", "produce"]
const CENT = 10_000n
const MIN_PER_UNIT = 1_000n

// Floors only decay: step down, round down to a cent, never below the minimum share of the first floor.
export function relistFloor(first: bigint, current: bigint, stepBps: number, minBps: number): bigint | null {
  const min = (first * BigInt(minBps)) / 10000n
  let next = ((current * BigInt(10000 - stepBps)) / 10000n / CENT) * CENT
  if (next < min) next = min
  if (next >= current || next < MIN_PER_UNIT) return null
  return next
}

export type TruckState = { agentId: Address; id: string; home: string; at: string; busy: boolean; currency: Currency; commodity: Commodity }

// Idle truck at the place; one that would otherwise drive home empty (a backhaul) goes first.
export function pickTruck(trucks: TruckState[], place: string, currency: Currency): TruckState | undefined {
  const idle = trucks.filter((t) => !t.busy && t.at === place && t.currency === currency)
  return idle.find((t) => t.home !== place) ?? idle[0]
}

export const slotDays = (qty: bigint, slotKg: bigint, days: number) => ((qty + slotKg - 1n) / slotKg) * BigInt(days)
export const dutyMax = (floor: bigint, bps: number) => (floor * BigInt(bps)) / 10000n

export type Family = { name: string; qty: bigint }
export const FAMILIES: Record<string, Family[]> = {
  shanti_niwas: [
    { name: "Flat 101", qty: 12n },
    { name: "Flat 204", qty: 8n },
    { name: "Flat 302", qty: 15n },
    { name: "Flat 405", qty: 5n },
    { name: "Flat 501", qty: 10n },
  ],
  eko_court: [
    { name: "Block A", qty: 20n },
    { name: "Block B", qty: 14n },
    { name: "Block C", qty: 6n },
  ],
}
export const pooledQty = (families: Family[]) => families.reduce((s, f) => s + f.qty, 0n)

// Pickup split by each family's share of the pooled order; the rounding remainder goes to the largest order.
export function poolSplit(units: bigint, families: Family[]): Array<Family & { units: bigint }> {
  const total = pooledQty(families)
  const out = families.map((f) => ({ ...f, units: total > 0n ? (units * f.qty) / total : 0n }))
  const rest = units - out.reduce((s, f) => s + f.units, 0n)
  if (out.length && rest > 0n) out.reduce((a, b) => (b.qty > a.qty ? b : a)).units += rest
  return out
}
