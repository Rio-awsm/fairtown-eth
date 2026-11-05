import type { TownEnvelope, TownSnapshot } from "@fairtown/shared/protocol"
import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"
import { EventBus, type EventBusApi, type MapStatus, type SceneProbe, type Selection } from "../game/EventBus"
import type { TownCommand } from "../game/commands"
import { commandsForState, hydrate, initialTownState, reduceEnvelope, type TownState } from "../game/reducer"
import { tickerLine } from "../hud/model"
import { loadMuted } from "../sound/prefs"
import { appendLedger, emptyLedger, type Ledger } from "../arkiv/mockLedger"
import type { RelayStatus } from "../net/relayClient"

export const COMMAND_LOG_MAX = 200
export const TICKER_MAX = 20

export type TickerLine = { id: string; text: string }

/** Town controls the presenter can change from /control or the keyboard (S3 5.1). */
export type TownUi = { director: boolean; priceWeather: boolean; qr: boolean; clockFocus: boolean; muted: boolean }
const isDemo = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1"

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
  /** Time of the latest envelope (replay or live), for the world clock. */
  ts: number | undefined
  ticker: TickerLine[]
  /** Mock Arkiv ledger built from relay events (contract 10 rules), for VITE_ARKIV=mock. */
  ledger: Ledger
  selection: Selection
  select(selection: Selection): void
  ui: TownUi
  setUi(patch: Partial<TownUi>): void
  /** Frames per second the scene reports (S3 5.1 target: 50+). */
  fps: number
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
    probe: () => ({ active: 0, agents: [], trucks: [], effectsSeen: {}, stalls: [] }),
    ts: undefined,
    ticker: [],
    ledger: emptyLedger(),
    selection: null,
    select: (selection) => set({ selection }),
    // The camera director is on by default only in demo mode, so tests and screenshots stay still.
    ui: { director: isDemo(), priceWeather: false, qr: true, clockFocus: false, muted: loadMuted() },
    setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
    fps: 0,
    setMode: (mode) => set({ mode }),
    setStatus: (status) => set({ status }),
    applySnapshot(snapshot) {
      const { state, commands } = hydrate(snapshot)
      set({ town: state, commandLog: appendLog(get().commandLog, commands) })
      bus.emit("town:commands", commands)
    },
    applyEnvelope(envelope) {
      const before = get().town
      const { state, commands } = reduceEnvelope(before, envelope)
      const line = tickerLine(before, envelope.event)
      set((s) => ({
        ts: envelope.ts,
        ledger: appendLedger(s.ledger, before, envelope),
        ticker: line ? [{ id: envelope.id, text: line }, ...s.ticker].slice(0, TICKER_MAX) : s.ticker,
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
  bus.on("select", (selection) => store.setState({ selection }))
  bus.on("scene:fps", (fps) => store.setState({ fps }))
  bus.on("scene:applied", (n) => store.setState((s) => ({ sceneCommandsApplied: s.sceneCommandsApplied + n })))
  return store
}

export const townStore = createTownStore(EventBus)

export const useTown = <T>(selector: (s: TownStoreState) => T): T => useStore(townStore, selector)
