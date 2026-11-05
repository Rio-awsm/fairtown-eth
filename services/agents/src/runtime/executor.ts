import type { Address } from "viem"
import type { ChainAdapter } from "../chain/types"
import { checkBid, DEFAULT_GUARDRAILS, type GuardrailConfig } from "./guardrails"
import type { Publisher } from "./publisher"
import type { Decision, Observation } from "./types"
import type { Wallets } from "./wallets"

export type ExecResult =
  | { status: "bid"; bidId: bigint; maxPerUnit: bigint; amount: bigint; clamped: string[] }
  | { status: "pass"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string }

export type Exposure = { onLot: Map<string, bigint>; total: bigint; best: Map<string, bigint>; bidTimes: number[] }

// Intent first (so the sprite walks), then Permit2 for this auction, then the bid. The only path to submitBid.
export class Executor {
  constructor(
    private readonly chain: ChainAdapter,
    private readonly wallets: Wallets,
    private readonly publisher: Publisher,
    private readonly cfg: GuardrailConfig = DEFAULT_GUARDRAILS,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(d: Decision, o: Observation, ex: Exposure): Promise<ExecResult> {
    const { agent, lot } = o
    const block = Number(await this.chain.blockNumber())
    if (d.action !== "bid") {
      await this.publisher.publish([{ type: "agent.intent", agentId: agent.agentId, action: "pass", lotId: lot.lotId.toString(), reason: d.reason }], block)
      return { status: "pass", reason: d.reason }
    }
    const g = checkBid(d, o, ex.bidTimes, this.now(), this.cfg)
    if (!g.ok) return { status: "rejected", reason: g.reason }

    await this.publisher.publish(
      [{ type: "agent.intent", agentId: agent.agentId, action: "bid", moveTo: lot.building, lotId: lot.lotId.toString(), reason: d.reason }],
      block,
    )
    const key = lot.lotId.toString()
    ex.bidTimes.push(this.now())
    try {
      const r = await this.wallets.queue(agent.agentId as Address, async () => {
        await this.chain.ensurePermit2(agent.agentId, lot.currency, lot.auction)
        return this.chain.submitBid(agent.agentId, { lotId: lot.lotId, maxPerUnit: g.maxPerUnit, amount: g.amount })
      })
      ex.onLot.set(key, (ex.onLot.get(key) ?? 0n) + g.amount)
      ex.total += g.amount
      if (g.maxPerUnit > (ex.best.get(key) ?? 0n)) ex.best.set(key, g.maxPerUnit)
      return { status: "bid", bidId: r.bidId, maxPerUnit: g.maxPerUnit, amount: g.amount, clamped: g.clamped }
    } catch (e) {
      return { status: "failed", reason: e instanceof Error ? e.message : String(e) }
    }
  }
}
