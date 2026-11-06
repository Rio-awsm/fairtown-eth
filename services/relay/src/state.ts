import type { LotStatus, SignalEvent, TownEnvelope, TownSnapshot } from "@fairtown/shared"

type SnapLot = TownSnapshot["lots"][number]
type SnapAgent = TownSnapshot["agents"][number]

const FORWARD: LotStatus[] = ["open", "sold", "truck_booked", "picked_up", "delivered", "paid_in_full"]

export class RelayState {
  private readonly seen = new Set<string>()
  private readonly lots = new Map<string, SnapLot>()
  private readonly agents = new Map<string, SnapAgent>()
  private readonly signals = new Map<string, SignalEvent>()
  private readonly fx: Record<string, number> = {}
  private readonly recent: TownEnvelope[] = []
  private block = 0

  constructor(
    private readonly recentMax = 200,
    private readonly seenMax = 10_000,
  ) {}

  ingest(env: TownEnvelope): boolean {
    if (this.seen.has(env.id)) return false
    this.seen.add(env.id)
    if (this.seen.size > this.seenMax) this.seen.delete(this.seen.values().next().value!)
    if (env.block !== undefined && env.block > this.block) this.block = env.block
    this.apply(env)
    this.recent.push(env)
    if (this.recent.length > this.recentMax) this.recent.shift()
    return true
  }

  nameOf(agentId: string) {
    return this.agents.get(agentId.toLowerCase())?.name ?? this.agents.get(agentId)?.name
  }

  get currentBlock() {
    return this.block
  }

  snapshot(): TownSnapshot {
    for (const [id, s] of this.signals) if (s.expiresAtBlock < this.block) this.signals.delete(id)
    return {
      block: this.block,
      lots: [...this.lots.values()].map((l) => ({ ...l })),
      agents: [...this.agents.values()].map((a) => ({ ...a })),
      signals: [...this.signals.values()],
      fx: { ...this.fx },
      recent: [...this.recent],
    }
  }

  private apply({ event: e }: TownEnvelope) {
    switch (e.type) {
      case "lot.listed":
        this.lots.set(e.lotId, { ...e, status: "open", bids: 0 })
        break
      case "bid.placed":
        this.patch(e.lotId, (l) => ({ bids: l.bids + 1 }))
        break
      case "price.tick":
        this.patch(e.lotId, () => ({ clearingPerUnit: e.clearingPerUnit }))
        break
      case "lot.settled":
        this.patch(e.lotId, () => ({
          status: e.soldUnits === "0" ? "unsold" : "sold",
          clearingPerUnit: e.finalClearingPerUnit,
          avgPerUnit: e.avgPerUnit,
          pickupDeadline: e.pickupDeadline,
        }))
        break
      case "lot.relisted":
        this.patch(e.lotId, () => ({ status: "relisted" }))
        break
      case "carrier.assigned":
        this.forward(e.lotId, "truck_booked")
        break
      case "handover.confirmed":
        this.forward(e.lotId, "picked_up")
        break
      case "lot.delivered":
        this.forward(e.lotId, "delivered")
        if (e.truckLotId !== "0") this.forward(e.truckLotId, "delivered")
        break
      case "lot.paid_in_full":
        this.forward(e.lotId, "paid_in_full")
        break
      case "noshow.reported":
        this.patch(e.lotId, () => ({ status: "no_show_reported" }))
        break
      case "noshow.contested":
      case "dispute.opened":
        this.patch(e.lotId, () => ({ status: "disputed" }))
        break
      case "noshow.refunded":
        this.patch(e.lotId, () => ({ status: "refunded" }))
        break
      case "dispute.resolved":
        this.patch(e.lotId, () => ({ status: e.refundBps > 0 ? "refunded" : "paid_in_full" }))
        break
      case "agent.spawned":
        this.agents.set(e.agentId, {
          agentId: e.agentId,
          name: e.name,
          role: e.role,
          building: e.building,
          sprite: e.sprite,
          ...(e.ensName ? { ensName: e.ensName } : {}),
        })
        break
      case "human.joined":
        this.agents.set(e.agentId, { agentId: e.agentId, name: e.name, role: "HUMAN", building: "town_gate", sprite: "human" })
        break
      case "agent.intent": {
        const a = this.agents.get(e.agentId)
        if (a && e.moveTo) a.building = e.moveTo
        break
      }
      case "signal":
        this.signals.set(e.id, e)
        break
      case "fx.updated":
        this.fx[e.currency] = e.perUsd
        break
      case "clock":
        if (e.block > this.block) this.block = e.block
        break
      default:
        break
    }
  }

  private patch(lotId: string, f: (l: SnapLot) => Partial<SnapLot>) {
    const lot = this.lots.get(lotId)
    if (lot) Object.assign(lot, f(lot))
  }
  private forward(lotId: string, to: LotStatus) {
    const lot = this.lots.get(lotId)
    if (!lot) return
    const cur = FORWARD.indexOf(lot.status)
    if (cur === -1 || FORWARD.indexOf(to) > cur) lot.status = to
  }
}
