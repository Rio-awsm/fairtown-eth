import type { LotListedEvent, Persona } from "@fairtown/shared"
import { readFileSync } from "node:fs"
import type { Address } from "viem"
import { checkBid } from "../runtime/guardrails"
import type { Decision, Observation, RuntimeAgent } from "../runtime/types"
import { findReference, type ReferenceRow } from "../listing/references"
import { createLlmStrategy, type LlmStrategyOptions, type Signal } from "../strategies/llm"

// Step 5.1 thresholds (guide): schema-valid 98%, fallback at most 10%, p95 within the D-19 4 s budget.
export const THRESHOLDS = { schemaValid: 0.98, fallbackMax: 0.1, p95MsMax: 4000 }

export type EvalCase = { id: string; o: Observation; signals: Signal[] }
export type EvalSample = { id: string; agent: string; lot: string; action: string; maxPerUnit?: string; reason: string; guardrail: string; source: "llm" | "rules" }
export type EvalReport = {
  provider: string
  n: number
  schemaValid: number
  fallbackRate: number
  p50Ms: number
  p95Ms: number
  fallbacks: Record<string, number>
  actions: Record<string, number>
  guardrails: { accepted: number; clamped: number; rejected: number }
  thresholds: typeof THRESHOLDS
  pass: boolean
  samples: EvalSample[]
}

export function loadFixtureLots(): LotListedEvent[] {
  const text = readFileSync(new URL("../../../../packages/shared/fixtures/day.jsonl", import.meta.url), "utf8")
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).event)
    .filter((e): e is LotListedEvent => e.type === "lot.listed")
}

const STORM: Signal = { kind: "weather", place: "bergen", severity: 3, label: "Storm closes the fjord tomorrow" }
const FESTIVAL: Signal = { kind: "festival", place: "mumbai", severity: 4, label: "Diwali in 3 days" }

// Deterministic cases where the rules would bid, so every case is a real question for the model.
export function buildCases(personas: Persona[], lots: LotListedEvent[], n: number): EvalCase[] {
  const pairs: Array<{ p: Persona; l: LotListedEvent; max: bigint; tick: bigint; floor: bigint }> = []
  for (const p of personas) {
    if (!p.mandate || !["BUYER", "SOCIETY"].includes(p.role)) continue
    for (const l of lots) {
      if (!p.mandate.commodities.includes(l.commodity as (typeof p.mandate.commodities)[number]) || l.currency !== p.currency) continue
      const floor = BigInt(l.floorPerUnit)
      const tick = floor / 100n + 1n
      const max = BigInt(p.mandate.maxPerUnit)
      if (floor + tick * 2n <= max) pairs.push({ p, l, max, tick, floor })
    }
  }
  if (!pairs.length) throw new Error("no persona and lot pairs to evaluate")
  const clearAt = [0n, 30n, 70n] // percent of the way from floor to mandate max
  const left = [400n, 150n, 20n]
  const cases: EvalCase[] = []
  for (let i = 0; i < n; i++) {
    const { p, l, max, tick, floor } = pairs[i % pairs.length]!
    const v = Math.floor(i / pairs.length)
    const span = max - tick * 2n - floor
    const clearing = floor + (span * clearAt[v % 3]!) / 100n
    const blocksLeft = left[Math.floor(v / 3) % 3]!
    const proven = Math.floor(v / 9) % 2 === 1
    const signal = Math.floor(v / 18) % 2 === 1 ? (l.place === "bergen" ? STORM : { ...FESTIVAL, place: l.place }) : undefined
    const agent: RuntimeAgent = {
      agentId: `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
      name: p.name,
      role: p.role,
      kind: p.kind,
      building: p.building,
      sprite: p.sprite,
      currency: p.currency,
      budget: BigInt(p.budget),
      mandate: p.mandate,
      paused: false,
      walletIndex: i,
      personaId: p.id,
    }
    cases.push({
      id: `case-${String(i + 1).padStart(3, "0")}`,
      signals: signal ? [signal] : [],
      o: {
        agent,
        budgetLeft: BigInt(p.budget),
        exposureOnLot: 0n,
        myBestOnLot: 0n,
        lot: {
          lotId: BigInt(l.lotId),
          auction: l.auction as Address,
          sector: l.sector,
          commodity: l.commodity,
          grade: l.grade as Observation["lot"]["grade"],
          building: l.building,
          place: l.place as Observation["lot"]["place"],
          seller: l.seller as Address,
          sellerName: l.sellerName,
          sellerRecord: { cleanLots: proven ? 4 : 0, noShows: 0, proven },
          currency: l.currency as Observation["lot"]["currency"],
          qty: BigInt(l.qty),
          floorPerUnit: floor,
          clearingPerUnit: clearing,
          tickPerUnit: tick,
          endBlock: 1000n,
          blocksLeft,
        },
      },
    })
  }
  return cases
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!
}

// paceRpm: run in batches per minute so the eval measures the model, not the provider's rate limit.
export async function runEval(
  opts: Pick<LlmStrategyOptions, "ai" | "timeoutMs"> & { provider: string; cases: EvalCase[]; references?: ReferenceRow[]; paceRpm?: number; onBatch?: (done: number) => void },
): Promise<EvalReport> {
  const byLot = new Map(opts.cases.map((c) => [c.o.lot, c]))
  const fellBack = new Set<string>()
  const strategy = createLlmStrategy({
    ai: opts.ai,
    cacheBlocks: 0n,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    onFallback: (_code, agent) => fellBack.add(agent.agentId),
    context: (lot) => {
      const r = opts.references && findReference(opts.references, lot.commodity, lot.place)
      const reference = r && r.currency === lot.currency ? BigInt(r.perUnit) : undefined
      return { ...(reference !== undefined ? { reference } : {}), recentClears: [], signals: byLot.get(lot)?.signals ?? [] }
    },
  })
  const batch = opts.paceRpm ?? opts.cases.length
  const results: Array<{ c: EvalCase; d: Decision }> = []
  for (let i = 0; i < opts.cases.length; i += batch) {
    const started = Date.now()
    results.push(...(await Promise.all(opts.cases.slice(i, i + batch).map(async (c) => ({ c, d: await strategy.decide(c.o) })))))
    opts.onBatch?.(results.length)
    if (i + batch < opts.cases.length) await new Promise((r) => setTimeout(r, Math.max(0, 60_000 - (Date.now() - started))))
  }
  const st = strategy.stats()
  const timeoutMs = opts.timeoutMs ?? 4000
  const ms = [...st.ms, ...Array<number>(st.fallbacks.timeout).fill(timeoutMs)]
  const fallbackCount = Object.values(st.fallbacks).reduce((a, b) => a + b, 0)
  const actions: Record<string, number> = {}
  const guardrails = { accepted: 0, clamped: 0, rejected: 0 }
  const samples: EvalSample[] = []
  for (const { c, d } of results) {
    actions[d.action] = (actions[d.action] ?? 0) + 1
    const g = d.action === "bid" ? checkBid(d as Decision, c.o, [], Date.now()) : undefined
    const guard = !g ? "n/a" : g.ok ? (g.clamped.length ? `clamped: ${g.clamped.join(", ")}` : "accepted") : `rejected: ${g.reason}`
    if (g?.ok) g.clamped.length ? guardrails.clamped++ : guardrails.accepted++
    else if (g) guardrails.rejected++
    samples.push({
      id: c.id,
      agent: c.o.agent.name,
      lot: `${c.o.lot.commodity} #${c.o.lot.lotId}`,
      action: d.action,
      ...(d.maxPerUnit ? { maxPerUnit: d.maxPerUnit } : {}),
      reason: d.reason,
      guardrail: guard,
      source: fellBack.has(c.o.agent.agentId) ? "rules" : "llm",
    })
  }
  const llm = st.llm || 1
  const report: EvalReport = {
    provider: opts.provider,
    n: opts.cases.length,
    schemaValid: st.firstTry / llm,
    fallbackRate: fallbackCount / llm,
    p50Ms: pct(ms, 0.5),
    p95Ms: pct(ms, 0.95),
    fallbacks: st.fallbacks,
    actions,
    guardrails,
    thresholds: THRESHOLDS,
    pass: false,
    samples,
  }
  report.pass = report.schemaValid >= THRESHOLDS.schemaValid && report.fallbackRate <= THRESHOLDS.fallbackMax && report.p95Ms <= THRESHOLDS.p95MsMax
  return report
}

export function reportMarkdown(r: EvalReport): string {
  const p = (x: number) => `${(x * 100).toFixed(1)}%`
  const ok = (b: boolean) => (b ? "pass" : "FAIL")
  const T = r.thresholds
  return [
    `# Bidder eval (S2 5.1)`,
    ``,
    `Provider: ${r.provider}. Decisions: ${r.n}. Overall: **${r.pass ? "PASS" : "FAIL"}**.`,
    ``,
    `| Metric | Value | Threshold | Result |`,
    `| --- | --- | --- | --- |`,
    `| Schema-valid on first try | ${p(r.schemaValid)} | >= ${p(T.schemaValid)} | ${ok(r.schemaValid >= T.schemaValid)} |`,
    `| Fallback to rules | ${p(r.fallbackRate)} | <= ${p(T.fallbackMax)} | ${ok(r.fallbackRate <= T.fallbackMax)} |`,
    `| p95 latency | ${r.p95Ms} ms | <= ${T.p95MsMax} ms | ${ok(r.p95Ms <= T.p95MsMax)} |`,
    `| p50 latency | ${r.p50Ms} ms | | |`,
    ``,
    `Fallbacks by cause: ${Object.entries(r.fallbacks).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `Actions: ${Object.entries(r.actions).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `Guardrails on bids: accepted ${r.guardrails.accepted}, clamped ${r.guardrails.clamped}, rejected ${r.guardrails.rejected}.`,
    ``,
    `## 20 reasons to read aloud`,
    ``,
    `| Case | Agent | Lot | Action | Reason | Guardrail |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...[...new Set(Array.from({ length: 20 }, (_, k) => (k * 37) % r.samples.length))] // 37 is coprime with 200: spreads over agents
      .map((i) => r.samples[i]!)
      .map((s) => `| ${s.id} | ${s.agent} | ${s.lot} | ${s.action} (${s.source}) | ${s.reason.replace(/\|/g, "/")} | ${s.guardrail} |`),
    ``,
  ].join("\n")
}
