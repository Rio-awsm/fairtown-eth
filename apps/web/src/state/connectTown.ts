import type { StoreApi } from "zustand/vanilla"
import type { WebEnv } from "../env"
import { createRelayClient, type RelayClient, type RelayHandlers } from "../net/relayClient"
import { createReplayClient, DAY_JSONL } from "../net/replayClient"
import type { TownStoreState } from "./townStore"

export type ConnectOptions = { speed?: number; WebSocketImpl?: typeof WebSocket; fetchImpl?: typeof fetch }

/** Wires the live relay or the in-browser replay into the store. Call once, outside React. */
export function connectTown(
  env: Pick<WebEnv, "relay">,
  store: StoreApi<TownStoreState>,
  opts: ConnectOptions = {},
): RelayClient {
  const s = () => store.getState()
  const handlers: RelayHandlers = {
    onSnapshot: (snapshot) => s().applySnapshot(snapshot),
    onEnvelope: (envelope) => s().applyEnvelope(envelope),
    onStatus: (status) => s().setStatus(status),
    onReject: () => s().noteReject(),
  }
  if (env.relay.mode === "mock") {
    s().setMode("replay")
    return createReplayClient({ jsonl: DAY_JSONL, speed: opts.speed ?? 1, handlers })
  }
  s().setMode("live")
  return createRelayClient({
    wsUrl: env.relay.wsUrl,
    snapshotUrl: env.relay.snapshotUrl,
    handlers,
    ...(opts.WebSocketImpl ? { WebSocketImpl: opts.WebSocketImpl } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })
}
