import type { TownCommand } from "./commands"

/** Town map load result. On "error" the scene falls back to the stub layout and lists the problems. */
export type MapStatus = { status: "loading" | "ready" | "error"; buildings: number; problems: string[] }

/** Events between React, the store and the Phaser scene. */
export type BusEvents = {
  "town:commands": TownCommand[]
  "map:status": MapStatus
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
