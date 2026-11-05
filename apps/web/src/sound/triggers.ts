import type { TownCommand } from "../game/commands"

export type Sound = "coin" | "gavel" | "rain" | "bells"

/** Which sound a town command plays (S3 5.1): coin on a bid, gavel on a sale, rain in a storm, bells to celebrate. */
export function soundFor(c: TownCommand): Sound | null {
  switch (c.kind) {
    case "coinArc":
      return "coin"
    case "flashClear":
      return "gavel"
    case "setWeather":
      return c.weather === "storm" ? "rain" : null
    case "setLights":
      return c.on && c.place ? "bells" : null
    case "setStatus":
      return c.status === "paid_in_full" ? "bells" : null
    default:
      return null
  }
}
