import { fromKey, fromQ96, type Building, type Grade, type Persona, type Place, type Sector } from "@fairtown/shared"
import type { Address } from "viem"
import type { ChainAdapter, ChainEvent } from "../chain/types"
import type { LedgerWriter } from "../arkiv/ledgerWriter"
import { Executor, type ExecResult, type Exposure } from "./executor"
import { DEFAULT_GUARDRAILS, type GuardrailConfig } from "./guardrails"
import type { Publisher } from "./publisher"
import type { LotObservation, MandateT, RuntimeAgent, Strategy } from "./types"
import type { Wallets } from "./wallets"

const BIDDERS = new Set(["BUYER", "SOCIETY", "HUMAN"])
const GAS_WEI = 10n ** 16n // fake chain default
const lc = (a: string) => a.toLowerCase() as Address

type TrackedLot = { lotId: bigint; seller: Address; currency: string; grade: Grade; place: Place; sector: Sector; building: Building; ended: boolean }
export type Decided = { agentId: Address; lotId: bigint; result: ExecResult }

export type RuntimeOptions = {
  chain: ChainAdapter
  wallets: Wallets
  publisher: Publisher
  strategy: Strategy
  ledger?: Pick<LedgerWriter, "writeAgent">
  gradeFor?: (lotId: bigint, metadataURI: string) => Grade | undefined
  nameOf?: (address: Address) => string | undefined
  markProven?: (address: Address) => unknown // operator marks seeded sellers proven (disclosed); awaited so operator nonces stay in order
  guardrails?: GuardrailConfig
  now?: () => number
  gasTopUpWei?: bigint // Base Sepolia gas is cheap; keep top-ups small so the operator wallet lasts
}

export class AgentRuntime {
  readonly agents = new Map<Address, RuntimeAgent>()
  private readonly exposure = new Map<Address, Exposure>()
  private readonly spent = new Map<Address, bigint>()
  private readonly bids = new Map<string, { agent: Address; amount: bigint; lotId: bigint }>()
  private readonly lots = new Map<string, TrackedLot>()
  private readonly executor: Executor
  private nextWallet = 0
  private timer?: ReturnType<typeof setInterval>
  private unwatch?: () => void
  private stepping = false
  readonly log: Decided[] = []

  constructor(private readonly o: RuntimeOptions) {
    this.executor = new Executor(o.chain, o.wallets, o.publisher, o.guardrails ?? DEFAULT_GUARDRAILS, o.now)
  }

  // ---------- agents ----------
  addPersonas(personas: Persona[]) {
    personas.forEach((p, i) => {
      const agentId = this.o.wallets.address(i)
      this.agents.set(agentId, {
        agentId,
        name: p.name,
        role: p.role,
        kind: p.kind,
        building: p.building,
        sprite: p.sprite,
        currency: p.currency,
        budget: BigInt(p.budget),
        ...(p.mandate ? { mandate: p.mandate } : {}),
        paused: false,
        walletIndex: i,
        personaId: p.id,
      })
    })
    this.nextWallet = Math.max(this.nextWallet, personas.length)
  }

  addAgent(a: Omit<RuntimeAgent, "agentId" | "walletIndex" | "paused">): RuntimeAgent {
    const walletIndex = this.nextWallet++
    const agent: RuntimeAgent = { ...a, agentId: this.o.wallets.address(walletIndex), walletIndex, paused: false }
    this.agents.set(agent.agentId, agent)
    return agent
  }

  patch(agentId: Address, p: { mandate?: Partial<MandateT>; paused?: boolean }) {
    const a = this.agents.get(lc(agentId))
    if (!a) return undefined
    if (p.paused !== undefined) a.paused = p.paused
    if (p.mandate) a.mandate = { ...(a.mandate ?? { commodities: [], maxPerUnit: "0", avoidNoShowSellers: true }), ...p.mandate } as MandateT
    return a
  }

  // Idempotent: register, fund the right stable up to budget, gas, write the agent entity, announce.
  async bootstrap(agents: RuntimeAgent[] = [...this.agents.values()], seededProven: string[] = []) {
    const { chain } = this.o
    for (const a of agents) {
      await chain.register(a.agentId, a.role, a.name)
      const have = await chain.balanceOf(a.currency, a.agentId)
      if (a.budget > have) await chain.mint(a.currency, a.agentId, a.budget - have)
      const gas = this.o.gasTopUpWei ?? GAS_WEI
      const eth = await chain.balanceOf("ETH", a.agentId)
      if (eth < gas / 2n) await chain.sendEth(a.agentId, gas - eth)
      if (a.personaId && seededProven.includes(a.personaId) && !(await chain.sellerRecord(a.agentId)).proven) await this.o.markProven?.(a.agentId)
      await this.o.ledger?.writeAgent(
        { id: a.personaId ?? a.agentId, name: a.name, role: a.role, building: a.building, ...(a.mandate ? { mandate: a.mandate } : {}) } as Persona,
        a.agentId,
      )
    }
    await this.o.publisher.publish(
      agents.map((a) => ({ type: "agent.spawned" as const, agentId: a.agentId, name: a.name, role: a.role, building: a.building, sprite: a.sprite })),
      Number(await chain.blockNumber()),
    )
  }

  view(agentId: Address) {
    const a = this.agents.get(lc(agentId))
    if (!a) return undefined
    const ex = this.ex(a.agentId)
    return {
      agentId: a.agentId,
      address: a.agentId,
      name: a.name,
      role: a.role,
      kind: a.kind,
      building: a.building,
      sprite: a.sprite,
      currency: a.currency,
      budget: a.budget.toString(),
      spent: (this.spent.get(a.agentId) ?? 0n).toString(),
      exposure: ex.total.toString(),
      budgetLeft: this.budgetLeft(a).toString(),
      mandate: a.mandate ?? null,
      paused: a.paused,
    }
  }

  // ---------- loop ----------
  start(tickMs = 3000) {
    this.unwatch = this.o.chain.watch((e) => this.onEvent(e))
    this.timer = setInterval(() => void this.step(), tickMs)
    this.timer.unref?.()
    return () => this.stop()
  }
  stop() {
    this.unwatch?.()
    if (this.timer) clearInterval(this.timer)
  }
  watchOnly() {
    this.unwatch = this.o.chain.watch((e) => this.onEvent(e))
    return () => this.unwatch?.()
  }

  onEvent(e: ChainEvent) {
    switch (e.eventName) {
      case "LotListed": {
        const a = e.args
        this.lots.set(a.lotId.toString(), {
          lotId: a.lotId,
          seller: lc(a.seller),
          currency: "",
          grade: this.o.gradeFor?.(a.lotId, a.metadataURI) ?? "na",
          place: fromKey(a.place) as Place,
          sector: fromKey(a.sector) as Sector,
          building: fromKey(a.market) as Building,
          ended: false,
        })
        return
      }
      case "BidExited": {
        const b = this.bids.get(e.args.bidId.toString())
        if (b) this.spent.set(b.agent, (this.spent.get(b.agent) ?? 0n) + b.amount - e.args.currencyRefunded)
        return
      }
      case "LotSettled": {
        const key = e.args.lotId.toString()
        const lot = this.lots.get(key)
        if (lot) lot.ended = true
        for (const ex of this.exposure.values()) {
          const held = ex.onLot.get(key) ?? 0n
          ex.total -= held
          ex.onLot.delete(key)
          ex.best.delete(key)
        }
        return
      }
      default:
        return
    }
  }

  // One pass over open lots: every bidding agent whose mandate covers the lot decides, guardrails check, executor acts.
  async step(): Promise<Decided[]> {
    if (this.stepping) return []
    this.stepping = true
    const out: Decided[] = []
    try {
      const { chain } = this.o
      const block = await chain.blockNumber()
      for (const t of this.lots.values()) {
        if (t.ended) continue
        const lot = await chain.getLot(t.lotId)
        if (lot.status !== "open" || block >= lot.endBlock) continue
        const record = await chain.sellerRecord(t.seller)
        const obsLot: LotObservation = {
          lotId: lot.lotId,
          auction: lot.auction,
          sector: lot.spec.sector,
          commodity: lot.spec.commodity,
          grade: t.grade !== "na" ? t.grade : lot.spec.grade,
          building: t.building,
          place: lot.spec.place,
          seller: t.seller,
          ...(this.o.nameOf?.(t.seller) ? { sellerName: this.o.nameOf(t.seller)! } : {}),
          sellerRecord: record,
          currency: lot.spec.currency,
          qty: lot.spec.qty,
          floorPerUnit: lot.spec.floorPerUnit,
          clearingPerUnit: lot.clearingPerUnit,
          tickPerUnit: fromQ96(lot.tickQ96) + 1n,
          endBlock: lot.endBlock,
          blocksLeft: lot.endBlock - block,
        }
        for (const a of this.agents.values()) {
          if (!BIDDERS.has(a.role) || a.paused || !a.mandate || a.currency !== obsLot.currency) continue
          if (!a.mandate.commodities.includes(obsLot.commodity as (typeof a.mandate.commodities)[number])) continue
          const ex = this.ex(a.agentId)
          const key = t.lotId.toString()
          const o = { agent: a, budgetLeft: this.budgetLeft(a), exposureOnLot: ex.onLot.get(key) ?? 0n, myBestOnLot: ex.best.get(key) ?? 0n, lot: obsLot }
          const d = await this.o.strategy.decide(o)
          if (d.action === "pass" && o.myBestOnLot > obsLot.clearingPerUnit) continue // quietly still winning
          const result = await this.executor.execute(d, o, ex)
          if (result.status === "bid") this.bids.set(result.bidId.toString(), { agent: a.agentId, amount: result.amount, lotId: t.lotId })
          const entry = { agentId: a.agentId, lotId: t.lotId, result }
          out.push(entry)
          this.log.push(entry)
          if (result.status === "bid") obsLot.clearingPerUnit = await chain.clearingPerUnit(t.lotId)
        }
      }
    } finally {
      this.stepping = false
    }
    return out
  }

  budgetLeft(a: RuntimeAgent) {
    const left = a.budget - (this.spent.get(a.agentId) ?? 0n) - this.ex(a.agentId).total
    return left > 0n ? left : 0n
  }
  private ex(agentId: Address): Exposure {
    let e = this.exposure.get(agentId)
    if (!e) {
      e = { onLot: new Map(), total: 0n, best: new Map(), bidTimes: [] }
      this.exposure.set(agentId, e)
    }
    return e
  }
}
