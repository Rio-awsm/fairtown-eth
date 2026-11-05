import type { StoreApi } from "zustand/vanilla"
import type { MapStatus, SceneProbe } from "../game/EventBus"
import type { TownCommand } from "../game/commands"
import type { TownState } from "../game/reducer"
import type { RelayStatus } from "../net/relayClient"
import type { TownMode, TownStoreState, TownUi } from "./townStore"

/** Read-only test hook (golden rule 4). Every getter returns a frozen copy. */
export type TownDebug = {
  readonly state: TownState
  readonly mode: TownMode
  readonly status: RelayStatus
  readonly eventsApplied: number
  readonly rejected: number
  readonly commandLog: readonly TownCommand[]
  readonly sceneCommandsApplied: number
  readonly map: MapStatus
  readonly agents: Pick<SceneProbe, "active" | "agents" | "trucks">
  readonly effectsSeen: Readonly<Record<string, number>>
  readonly stallsOnScreen: SceneProbe["stalls"]
  readonly fps: number
  readonly ui: TownUi
  readonly lastEventId: string | undefined
}

declare global {
  interface Window {
    __TOWN__?: TownDebug
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}
const frozen = <T>(value: T): T => deepFreeze(structuredClone(value))

/** Defines `target.__TOWN__` when enabled. Never call with `enabled` true in production. */
export function exposeTown(target: object, store: StoreApi<TownStoreState>, enabled: boolean): void {
  if (!enabled) return
  const s = () => store.getState()
  const hook: TownDebug = Object.freeze({
    get state() {
      return frozen(s().town)
    },
    get mode() {
      return s().mode
    },
    get status() {
      return s().status
    },
    get eventsApplied() {
      return s().eventsApplied
    },
    get rejected() {
      return s().rejected
    },
    get commandLog() {
      return frozen(s().commandLog)
    },
    get sceneCommandsApplied() {
      return s().sceneCommandsApplied
    },
    get map() {
      return frozen(s().map)
    },
    get agents() {
      const { active, agents, trucks } = s().probe()
      return frozen({ active, agents, trucks })
    },
    get fps() {
      return s().fps
    },
    get ui() {
      return frozen(s().ui)
    },
    get stallsOnScreen() {
      return frozen(s().probe().stalls)
    },
    get effectsSeen() {
      return frozen(s().probe().effectsSeen)
    },
    get lastEventId() {
      return s().lastEventId
    },
  })
  Object.defineProperty(target, "__TOWN__", { value: hook, writable: false, configurable: false, enumerable: false })
}
