import type { TownSnapshot } from "@fairtown/shared/protocol"
import dayJsonl from "../mocks/day.jsonl?raw"
import { Deduper } from "./dedupe"
import { parseJsonl } from "./jsonl"
import type { RelayClient, RelayHandlers } from "./relayClient"

// Swap point: when S2 0.1 ships the shared fixture, import "@fairtown/shared/fixtures/day.jsonl?raw" instead.
export const DAY_JSONL: string = dayJsonl

export type ReplayClientOptions = { jsonl: string; speed: number; handlers: RelayHandlers }

const EMPTY_SNAPSHOT: TownSnapshot = { block: 0, lots: [], agents: [], signals: [], fx: {}, recent: [] }

/** `VITE_RELAY_URL=mock` (contract 13): replays day.jsonl in the browser at the recorded pace divided by speed. */
export function createReplayClient({ jsonl, speed, handlers }: ReplayClientOptions): RelayClient {
  const pace = speed > 0 ? speed : 1
  const dedupe = new Deduper()
  let started = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    start() {
      if (started) return
      started = true
      handlers.onStatus("replay")
      handlers.onSnapshot(EMPTY_SNAPSHOT)
      const { envelopes, rejected } = parseJsonl(jsonl)
      for (const r of rejected) {
        console.warn(`replay line ${r.line} rejected: ${r.reason}`)
        handlers.onReject(`line ${r.line}: ${r.reason}`)
      }
      const step = (i: number) => {
        if (stopped) return
        const e = envelopes[i]
        if (!e) return handlers.onStatus("replay_done")
        if (!dedupe.seen(e.id)) handlers.onEnvelope(e)
        const next = envelopes[i + 1]
        if (!next) return handlers.onStatus("replay_done")
        timer = setTimeout(() => step(i + 1), Math.max(0, next.ts - e.ts) / pace)
      }
      timer = setTimeout(() => step(0), 0)
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}
