import type { Building, LotStatus, Role } from "@fairtown/shared/keys"

export type Phase = "dawn" | "morning" | "noon" | "evening" | "night"

/** What the reducer asks the scene to draw. Every visual effect is one of these (S3 1.3 key rule). */
export type TownCommand =
  | {
      kind: "spawnAgent"
      agentId: string
      label: string
      role: Role
      building: Building
      sprite: string
      highlight: boolean
    }
  | { kind: "walkTo"; agentId: string; building: Building }
  | { kind: "showBubble"; agentId: string; text: string }
  | {
      kind: "placeStall"
      lotId: string
      building: Building
      slot: number | null
      commodity: string
      qty: number
      unit: string
      floorLabel: string
      endBlock: number
    }
  | { kind: "tickPrice"; lotId: string; priceLabel?: string; bids: number }
  | { kind: "flashClear"; lotId: string }
  | { kind: "toast"; text: string; tone: "info" | "money" | "warn" }
  | { kind: "driveTruck"; lotId: string; from: Building; to: Building }
  | { kind: "moveCrate"; lotId: string; from: Building; to: "truck" | "buyer" }
  | { kind: "setStatus"; lotId: string; status: LotStatus; deadlineBlock?: number }
  | { kind: "setWeather"; place: string; weather: "storm" | "quiet" | "clear"; severity: number; label: string }
  | { kind: "setLights"; on: boolean; place?: string; label?: string }
  | { kind: "fadeStall"; lotId: string; newFloorLabel?: string }
  | { kind: "markSeller"; seller: string; tier: "new" | "proven"; cleanLots: number; noShows: number }
  | { kind: "refundCoins"; lotId: string; buyer: string; amountLabel: string }
  | { kind: "setPhase"; phase: Phase }

export const COMMAND_KINDS = [
  "spawnAgent",
  "walkTo",
  "showBubble",
  "placeStall",
  "tickPrice",
  "flashClear",
  "toast",
  "driveTruck",
  "moveCrate",
  "setStatus",
  "setWeather",
  "setLights",
  "fadeStall",
  "markSeller",
  "refundCoins",
  "setPhase",
] as const satisfies readonly TownCommand["kind"][]

/** Speech bubbles hold at most 80 characters (S3 1.2). */
export const BUBBLE_MAX = 80
