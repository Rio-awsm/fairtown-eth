import { fromKey, MARKET_OF_SECTOR, type Building, type Commodity, type Sector, type SignalKind, type TownEvent } from "@fairtown/shared"
import { FxResponse } from "@fairtown/shared/api"
import { readFileSync } from "node:fs"
import type { z } from "zod"
import type { ChainAdapter, ChainEvent } from "../chain/types"
import { SECTOR_OF } from "../listing/catalog"
import type { ReferenceRow } from "../listing/references"
import type { Signal } from "../strategies/llm"

export type LiveSignal = Signal & { id: bigint; expiresAtBlock: bigint }
export type Fx = z.infer<typeof FxResponse>

// D-91 (multipliers, needs Rio-awsm): which sectors a signal kind moves, and how hard. Severity is 1 to 5.
export const SIGNAL_SECTORS: Record<SignalKind, readonly Sector[]> = {
  weather: ["fish", "produce"],
  festival: ["flowers", "produce"],
  demand_dip: ["fish", "flowers", "produce"],
  reference: [],
}
export const URGENCY_PER_SEVERITY_BPS = 1000 // severity 5 storm or festival: x1.5; severity 5 demand dip: x0.5
const MIN_URGENCY_BPS = 5000
const MAX_SEVERITY = 5

// A signal for a market town also reaches the places that sell into it.
export const REGION: Record<string, string> = { pune: "mumbai" }
const reaches = (signalPlace: string, place: string) => signalPlace === place || REGION[place] === signalPlace || signalPlace === "any"

export const loadFxSnapshot = (): Fx => FxResponse.parse(JSON.parse(readFileSync(new URL("../data/fx.json", import.meta.url), "utf8")))

// Live market inputs from SignalOracle events (S1 4.2, 4.3), with the dated snapshots as fallback.
// Reference updates are upserted into the shared rows, so listing floors, /api/reference and strategies all see them.
export class MarketState {
  private readonly signals = new Map<string, LiveSignal>()
  private fx: Fx
  private unwatch?: () => void

  constructor(
    private readonly o: {
      chain: Pick<ChainAdapter, "watch">
      references: ReferenceRow[]
      fx?: Fx
      onSignal?: (s: LiveSignal, sectors: readonly Sector[]) => void
    },
  ) {
    this.fx = structuredClone(o.fx ?? loadFxSnapshot())
  }

  start() {
    this.unwatch = this.o.chain.watch((e) => this.onEvent(e))
    return () => this.unwatch?.()
  }

  onEvent(e: ChainEvent) {
    switch (e.eventName) {
      case "DemandSignal": {
        const a = e.args
        const kind = fromKey(a.signalKind) as SignalKind
        const s: LiveSignal = { id: a.id, kind, place: fromKey(a.place), severity: Math.min(a.severity, MAX_SEVERITY), label: a.label, expiresAtBlock: a.expiresAtBlock }
        this.signals.set(a.id.toString(), s)
        this.o.onSignal?.(s, SIGNAL_SECTORS[kind] ?? [])
        return
      }
      case "ReferencePriceUpdated": {
        const a = e.args
        if (a.perUnit === 0n) return // never use an unparsed price
        const row: ReferenceRow = {
          commodity: fromKey(a.commodity),
          market: fromKey(a.market),
          perUnit: a.perUnit.toString(),
          currency: fromKey(a.currencyCode),
          date: `block ${a.updatedAt}`,
          source: `CRE W1: ${fromKey(a.sourceTag)}`,
          sourceUrl: "",
        }
        const i = this.o.references.findIndex((r) => r.commodity === row.commodity && r.market === row.market)
        if (i >= 0) this.o.references[i] = row
        else this.o.references.push(row)
        return
      }
      case "FxUpdated": {
        const a = e.args
        if (a.perUsdE8 === 0n) return
        // Display only (contract 5): a JS number is fine here, never for money.
        this.fx = { ...this.fx, rates: { ...this.fx.rates, [fromKey(a.currencyCode)]: Number(a.perUsdE8) / 1e8 }, date: `block ${a.updatedAt}`, source: "CRE W1 (Frankfurter) via SignalOracle" }
        return
      }
      default:
        return
    }
  }

  active(block: bigint): LiveSignal[] {
    for (const [k, s] of this.signals) if (s.expiresAtBlock <= block) this.signals.delete(k)
    return [...this.signals.values()]
  }

  // Signals that touch a lot: same place (or its market town) and a sector the kind moves.
  signalsFor(place: string, sector: Sector, block: bigint): LiveSignal[] {
    return this.active(block).filter((s) => reaches(s.place, place) && (SIGNAL_SECTORS[s.kind as SignalKind] ?? []).includes(sector))
  }

  // Urgency for bidding: storms and festivals push up, demand dips pull down; strongest of each applies.
  urgencyBps(place: string, sector: Sector, block: bigint): number {
    const sig = this.signalsFor(place, sector, block)
    const up = Math.max(0, ...sig.filter((s) => s.kind !== "demand_dip").map((s) => s.severity))
    const down = Math.max(0, ...sig.filter((s) => s.kind === "demand_dip").map((s) => s.severity))
    return Math.max(MIN_URGENCY_BPS, 10000 + (up - down) * URGENCY_PER_SEVERITY_BPS)
  }

  fxView(): Fx {
    return structuredClone(this.fx)
  }
}

// Buyers whose mandate covers a sector the signal moves, and the building they walk to.
export function affectedBuyers<A extends { agentId: string; role: string; mandate?: { commodities: readonly string[]; place?: string } }>(agents: Iterable<A>, sectors: readonly Sector[], place: string) {
  const out: Array<{ agent: A; building: Building }> = []
  for (const a of agents) {
    if (!["BUYER", "SOCIETY"].includes(a.role) || !a.mandate) continue
    if (a.mandate.place && !reaches(place, a.mandate.place)) continue
    const sector = a.mandate.commodities.map((c) => SECTOR_OF[c as Commodity]).find((s) => s && sectors.includes(s))
    if (sector) out.push({ agent: a, building: MARKET_OF_SECTOR[sector as keyof typeof MARKET_OF_SECTOR] })
  }
  return out
}

// On a signal, affected buyers walk to their market so the town shows the reaction (scene 1: buyers walk to the dock).
export async function moveOnSignal(
  s: LiveSignal,
  sectors: readonly Sector[],
  agents: Iterable<{ agentId: string; role: string; mandate?: { commodities: readonly string[]; place?: string } }>,
  publish: (events: TownEvent[]) => Promise<void>,
) {
  const moves = affectedBuyers(agents, sectors, s.place)
  if (!moves.length) return 0
  await publish(moves.map(({ agent, building }) => ({ type: "agent.intent" as const, agentId: agent.agentId, action: "move" as const, moveTo: building, reason: `${s.label}: heading to the ${building.replace("_", " ")}`.slice(0, 80) })))
  return moves.length
}
