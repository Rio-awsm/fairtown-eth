import type { Building } from "@fairtown/shared/keys"
import type { TownCommand } from "./commands"

/** Where the camera director looks for a command, or null to stay put (S3 5.1). */
export function focusFor(c: TownCommand, buildingOfLot: (lotId: string) => Building | undefined): Building | null {
  switch (c.kind) {
    case "placeStall":
      return c.building
    case "spawnAgent":
      return c.highlight ? c.building : null
    case "moveCrate":
      return c.from
    case "driveTruck":
      return c.to
    case "flashClear":
    case "refundCoins":
      return buildingOfLot(c.lotId) ?? null
    case "setStatus":
      return c.status === "no_show_reported" || c.status === "paid_in_full" ? (buildingOfLot(c.lotId) ?? null) : null
    default:
      return null
  }
}
