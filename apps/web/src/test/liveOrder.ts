import type { TownCommand } from "../game/commands"

// Helpers for the live town e2e (C 1.2). __TOWN__.commandLog keeps only the last COMMAND_LOG_MAX commands, so the test
// polls it and stitches each window onto what it has already seen.

/** Appends the part of `window` that `seen` does not end with yet (largest suffix/prefix overlap). */
export function mergeLog<T>(seen: T[], window: T[], key: (x: T) => string = (x) => JSON.stringify(x)): T[] {
  const a = seen.map(key)
  const b = window.map(key)
  for (let k = Math.min(a.length, b.length); k > 0; k--) {
    let match = true
    for (let i = 0; i < k; i++) {
      if (a[a.length - k + i] !== b[i]) {
        match = false
        break
      }
    }
    if (match) return [...seen, ...window.slice(k)]
  }
  return [...seen, ...window]
}

export type WalkOrder = { bids: number; bidders: string[]; walkers: string[]; violations: string[] }

/** Agents walk before their bids land: every coinArc on the lot follows a walkTo by the same agent. */
export function walkBeforeBid(commands: readonly TownCommand[], lotId: string): WalkOrder {
  const walked = new Set<string>()
  const walkers = new Set<string>()
  const bidders = new Set<string>()
  const violations: string[] = []
  let bids = 0
  for (const c of commands) {
    if (c.kind === "walkTo") {
      walked.add(c.agentId)
      walkers.add(c.agentId)
    } else if (c.kind === "coinArc" && c.lotId === lotId) {
      bids++
      bidders.add(c.agentId)
      if (!walked.has(c.agentId)) violations.push(c.agentId)
    }
  }
  return { bids, bidders: [...bidders], walkers: [...walkers], violations }
}
