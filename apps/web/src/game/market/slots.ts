import type { Building } from "@fairtown/shared/keys"

/** Seconds per block on Base Sepolia (contract 5: about 2 s). */
export const SECONDS_PER_BLOCK = 2

/**
 * Which drawn stall occupies each slot. The reducer frees a slot when a lot finishes, but the scene
 * keeps the finished stall on screen (gold, refunded) until a new lot needs that slot.
 */
export class StallSlots {
  private readonly holders = new Map<string, string>()
  private readonly slotOfLot = new Map<string, string>()

  place(lotId: string, building: Building, slot: number | null): { evicted?: string } {
    const previous = this.slotOfLot.get(lotId)
    if (slot === null) {
      this.release(lotId)
      return {}
    }
    const key = `${building}:${slot}`
    if (previous === key) return {}
    this.release(lotId)
    const evicted = this.holders.get(key)
    if (evicted) this.slotOfLot.delete(evicted)
    this.holders.set(key, lotId)
    this.slotOfLot.set(lotId, key)
    return evicted ? { evicted } : {}
  }

  release(lotId: string): void {
    const key = this.slotOfLot.get(lotId)
    if (key && this.holders.get(key) === lotId) this.holders.delete(key)
    this.slotOfLot.delete(lotId)
  }

  holder(building: Building, slot: number): string | undefined {
    return this.holders.get(`${building}:${slot}`)
  }
}

/** Time left until a block, as m:ss. Block-based, so screenshots are deterministic. */
export function countdown(targetBlock: number, nowBlock: number): string {
  const seconds = Math.max(0, targetBlock - nowBlock) * SECONDS_PER_BLOCK
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const PLACE_BUILDING: Record<string, Building> = {
  bergen: "fish_dock",
  oslo: "fish_dock",
  hamburg: "fish_dock",
  dallas: "freight_yard",
  houston: "freight_yard",
  mumbai: "flower_hall",
  pune: "flower_hall",
  nairobi: "flower_hall",
  amsterdam: "flower_hall",
  lagos: "harvest_hall",
  any_dc: "compute_yard",
}

/** The building whose sky shows a place's weather and lights. */
export const placeBuilding = (place: string): Building | undefined => PLACE_BUILDING[place]
