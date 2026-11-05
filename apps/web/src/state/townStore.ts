import type { TownEnvelope, TownSnapshot } from "@fairtown/shared/protocol"
import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"
import { EventBus, type EventBusApi, type MapStatus, type SceneProbe } from "../game/EventBus"
import type { TownCommand } from "../game/commands"
import { commandsForState, hydrate, initialTownState, reduce, type TownState } from "../game/reducer"
import type { RelayStatus } from "../net/relayClient"

export const COMMAND_LOG_MAX = 200

export type TownMode = "live" | "replay"

export type TownStoreState = {
  town: TownState
  mode: TownMode
  status: RelayStatus
  eventsApplied: number
  rejected: number
  commandLog: TownCommand[]
  sceneCommandsApplied: number
  map: MapStatus
  /** Set by the scene once it runs; reads live sprite positions. */
  probe: () => SceneProbe
  lastEventId?: string
  setMode(mode: TownMode): void
  setStatus(status: RelayStatus): void
  applySnapshot(snapshot: TownSnapshot): void
  applyEnvelope(envelope: TownEnvelope): void
  noteReject(): void
}

const appendLog = (log: TownCommand[], commands: TownCommand[]) =>
  commands.length === 0 ? log : [...log, ...commands].slice(-COMMAND_LOG_MAX)

/** The town's single source of state. Runs the pure reducer and hands its commands to the scene over the bus. */
export function createTownStore(bus: EventBusApi): StoreApi<TownStoreState> {
  const store = createStore<TownStoreState>()((set, get) => ({
    town: initialTownState,
    mode: "replay",
    status: "connecting",
    eventsApplied: 0,
    rejected: 0,
    commandLog: [],
    sceneCommandsApplied: 0,
    map: { status: "loading", buildings: 0, problems: [] },
    probe: () => ({ active: 0, agents: [], trucks: [] }),
    setMode: (mode) => set({ mode }),
    setStatus: (status) => set({ status }),
    applySnapshot(snapshot) {
      const { state, commands } = hydrate(snapshot)
      set({ town: state, commandLog: appendLog(get().commandLog, commands) })
      bus.emit("town:commands", commands)
    },
    applyEnvelope(envelope) {
      const { state, commands } = reduce(get().town, envelope.event)
      set((s) => ({
        town: state,
        eventsApplied: s.eventsApplied + 1,
        lastEventId: envelope.id,
        commandLog: appendLog(s.commandLog, commands),
      }))
      if (commands.length > 0) bus.emit("town:commands", commands)
    },
    noteReject: () => set((s) => ({ rejected: s.rejected + 1 })),
  }))

  bus.on("scene:ready", () => bus.emit("town:commands", commandsForState(store.getState().town)))
  bus.on("map:status", (map) => store.setState({ map }))
  bus.on("scene:probe", (probe) => store.setState({ probe }))
  bus.on("scene:applied", (n) => store.setState((s) => ({ sceneCommandsApplied: s.sceneCommandsApplied + n })))
  return store
}

export const townStore = createTownStore(EventBus)

export const useTown = <T>(selector: (s: TownStoreState) => T): T => useStore(townStore, selector)
