import type { Building } from "@fairtown/shared/keys"
import type { TownCommand } from "./commands"

/** Stress mode (`/town?stress=1`, dev only): the S3 5.1 target load of 60 agents and 18 stalls. */
export const STRESS_AGENTS = 60
export const STRESS_STALLS = 18
const BUILDINGS: Building[] = ["fish_dock", "freight_yard", "flower_hall", "harvest_hall", "compute_yard", "cold_vault"]
const agentId = (i: number) => `0x${(0x5000 + i).toString(16).padStart(40, "0")}`

export function stressCommands(): TownCommand[] {
  const stalls: TownCommand[] = BUILDINGS.flatMap((building, b) =>
    [1, 2, 3].map((slot) => ({
      kind: "placeStall" as const,
      lotId: `stress-${b * 3 + slot}`,
      building,
      slot,
      commodity: "cod",
      qty: 100,
      unit: "kg",
      floorLabel: "€1.00/kg",
      endBlock: 999_999,
      seller: agentId(1000 + b),
    })),
  )
  const agents: TownCommand[] = Array.from({ length: STRESS_AGENTS }, (_, i) => ({
    kind: "spawnAgent" as const,
    agentId: agentId(i),
    label: `Agent ${i + 1}`,
    role: "BUYER" as const,
    building: BUILDINGS[i % BUILDINGS.length]!,
    sprite: "bot",
    highlight: false,
  }))
  return [...stalls, ...agents]
}

/** Ten agents set off for another building each tick, in a repeatable order. */
export function stressWalk(tick: number): TownCommand[] {
  return Array.from({ length: 10 }, (_, k) => {
    const i = (tick * 10 + k) % STRESS_AGENTS
    return { kind: "walkTo" as const, agentId: agentId(i), building: BUILDINGS[(i + tick + 1) % BUILDINGS.length]! }
  })
}
