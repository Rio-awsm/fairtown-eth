import type { Building } from "@fairtown/shared/keys"

export type QueueSpot = { building: Building; index: number }

/** Queue spots per building. One agent per spot, one spot per agent (S3 1.2 key rule). */
export class QueueAllocator {
  private readonly spots = new Map<Building, (string | undefined)[]>()
  private readonly held = new Map<string, QueueSpot>()

  constructor(private readonly perBuilding = 8) {}

  /** The agent's spot at this building, or null if the building is full or has no queue. */
  claim(agentId: string, building: Building): number | null {
    const current = this.held.get(agentId)
    if (current?.building === building) return current.index
    if (building === "town_gate") {
      this.release(agentId)
      return null
    }
    const row = this.spots.get(building) ?? new Array<string | undefined>(this.perBuilding).fill(undefined)
    this.spots.set(building, row)
    this.release(agentId)
    const index = row.findIndex((who) => who === undefined)
    if (index === -1) return null
    row[index] = agentId
    this.held.set(agentId, { building, index })
    return index
  }

  release(agentId: string): void {
    const spot = this.held.get(agentId)
    if (!spot) return
    const row = this.spots.get(spot.building)
    if (row) row[spot.index] = undefined
    this.held.delete(agentId)
  }

  spotOf(agentId: string): QueueSpot | undefined {
    return this.held.get(agentId)
  }

  occupant(building: Building, index: number): string | undefined {
    return this.spots.get(building)?.[index]
  }
}
