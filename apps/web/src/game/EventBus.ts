import type { Building } from "@fairtown/shared/keys"
import type { TownCommand } from "./commands"

/** Town map load result. On "error" the scene falls back to the stub layout and lists the problems. */
export type MapStatus = { status: "loading" | "ready" | "error"; buildings: number; problems: string[] }

/** What the scene reports about its sprites, for the e2e checks (no agent on a blocked tile, no shared spot). */
export type AgentProbe = { id: string; x: number; y: number; blocked: boolean; queue: string | null }
/** effectsSeen: how many times the scene played each effect (S3 1.3), by command kind or kind:variant. */
export type SceneProbe = {
  active: number
  agents: AgentProbe[]
  trucks: AgentProbe[]
  effectsSeen: Record<string, number>
  /** Where each stall sits in game pixels (1920 × 1080), so e2e can click it. */
  stalls: { lotId: string; x: number; y: number }[]
}

/** What a click in the scene or a panel opens (S3 1.4). */
export type Selection =
  { kind: "lot"; id: string } | { kind: "agent"; id: string } | { kind: "building"; id: Building } | null

/** Events between React, the store and the Phaser scene. */
export type BusEvents = {
  "town:commands": TownCommand[]
  "map:status": MapStatus
  "scene:probe": () => SceneProbe
  select: Selection
  "scene:fps": number
  /** Presenter "jump to building" (S3 5.1). */
  "camera:jump": string
  /** Price weather tint per market building (S3 4.1); null turns it off. */
  priceWeather: Record<string, "much_lower" | "lower" | "normal" | "higher" | "much_higher"> | null
  "scene:ready": undefined
  "scene:applied": number
}

type Listener<T> = (payload: T) => void

export type EventBusApi = {
  on<K extends keyof BusEvents>(event: K, fn: Listener<BusEvents[K]>): () => void
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void
}

/**
 * A small typed emitter instead of Phaser's, so the store and phone pages never import Phaser.
 * A throwing listener is reported and does not stop the others.
 */
export function createEventBus(): EventBusApi {
  const listeners = new Map<keyof BusEvents, Set<Listener<never>>>()
  return {
    on(event, fn) {
      const set = listeners.get(event) ?? new Set()
      set.add(fn as Listener<never>)
      listeners.set(event, set)
      return () => void set.delete(fn as Listener<never>)
    },
    emit(event, payload) {
      for (const fn of [...(listeners.get(event) ?? [])]) {
        try {
          ;(fn as Listener<typeof payload>)(payload)
        } catch (error: unknown) {
          console.error(`EventBus listener for ${event} failed`, error)
        }
      }
    },
  }
}

export const EventBus = createEventBus()
