import type { AiGateway } from "./ai/gateway"
import type { LedgerWriter } from "./arkiv/ledgerWriter"
import type { ChainFeed } from "./chain/feed"
import type { AgentRuntime } from "./runtime/runtime"
import type { SectorEngine } from "./sectors/engine"

export type Dep = { ok: boolean; detail: string }
export type HealthExtras = { relay: Dep; ledger: Dep; feed: Dep; runtime: Dep; llm: Dep }

// Everything /api/health reports beyond contract 11's chain, arkiv and ai. Each part says how it degrades.
export function healthExtras(d: {
  relayUrl: string
  ledger?: Pick<LedgerWriter, "written" | "failed" | "retried" | "pending">
  feed?: Pick<ChainFeed, "fromBlock" | "caughtUpTo" | "events">
  engine?: Pick<SectorEngine, "replaying">
  runtime?: Pick<AgentRuntime, "agents">
  ai?: Pick<AiGateway, "stats">
  llmOn: boolean
  fetch?: typeof fetch
}): () => Promise<HealthExtras> {
  const f = d.fetch ?? fetch
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)
  return async () => {
    let relay: Dep
    try {
      const res = await f(`${d.relayUrl.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(1000) })
      const body = (await res.json()) as { clients?: number; block?: number }
      relay = { ok: res.ok, detail: `${body.clients ?? 0} town clients, block ${body.block ?? "?"}` }
    } catch {
      relay = { ok: false, detail: "unreachable: town updates are dropped, bids and payouts carry on" }
    }
    const l = d.ledger
    const failed = l ? sum(l.failed) : 0
    const ledger: Dep = l
      ? { ok: failed === 0, detail: `${sum(l.written)} Arkiv writes, ${l.pending} queued, ${sum(l.retried)} retried, ${failed} failed${failed ? " (chain stays the truth for money)" : ""}` }
      : { ok: true, detail: "not running" }
    const fd = d.feed
    const caught = fd?.caughtUpTo
    const feed: Dep = !fd
      ? { ok: true, detail: "direct (fake chain)" }
      : caught === undefined
        ? { ok: false, detail: `backfilling from block ${fd.fromBlock ?? "head"}` }
        : { ok: true, detail: `caught up to block ${caught}, ${fd.events} events since ${fd.fromBlock ?? "start"}${d.engine?.replaying() ? ", sector replay pending" : ""}` }
    const agents = d.runtime ? [...d.runtime.agents.values()] : []
    const runtime: Dep = { ok: agents.length > 0, detail: `${agents.length} agents, ${agents.filter((a) => a.manual).length} walk-ins, ${agents.filter((a) => a.paused).length} paused` }
    const b = d.ai?.stats().bidder
    const llm: Dep = !d.llmOn
      ? { ok: true, detail: "MOCK_AI=1: rule strategy" }
      : { ok: !b || b.calls === 0 || b.failures + b.timeouts < b.calls / 2, detail: b ? `${b.calls} bidder calls, ${b.ok} ok, ${b.timeouts} timeouts, ${b.failures} failures: rules decide on any failure` : "no calls yet" }
    return { relay, ledger, feed, runtime, llm }
  }
}
