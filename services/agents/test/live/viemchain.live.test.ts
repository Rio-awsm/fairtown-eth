import { toBase } from "@fairtown/shared"
import { marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { loadEnv } from "@fairtown/shared/env"
import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import { writerAccount } from "../../src/adapters"
import { ViemChain } from "../../src/chain/viem/ViemChain"
import type { ChainEvent } from "../../src/chain/types"
import { PERSONAS } from "../../src/fixtures/personas"
import { MemoryPublisher } from "../../src/runtime/publisher"
import { AgentRuntime } from "../../src/runtime/runtime"
import { Wallets } from "../../src/runtime/wallets"
import { ruleStrategy } from "../../src/strategies/rule"

// Opt-in: pnpm -F agents test:live. Real Base Sepolia, TEST MONEY: register, mint, Permit2, list, rule bids, settle.
const { env } = loadEnv(new URL("../../../../.env", import.meta.url).pathname)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("ViemChain + runtime on Base Sepolia", () => {
  it("lists a lot, bids by rules through guardrails, settles and sees every event", async () => {
    const deployment = await loadDeployment("base-sepolia")
    const wallets = new Wallets(env.AGENT_MNEMONIC!)
    const operator = writerAccount(env.OPERATOR_PRIVATE_KEY!)
    const chain = new ViemChain({ deployment, rpcUrl: env.RPC_URL!, operator, accountFor: wallets.accountFor })
    const events: ChainEvent[] = []
    const stopWatch = chain.watch((e) => events.push(e))

    const runtime = new AgentRuntime({ chain, wallets, publisher: new MemoryPublisher(), strategy: ruleStrategy, gasTopUpWei: 5n * 10n ** 14n })
    runtime.addPersonas(PERSONAS)
    const idx = (id: string) => PERSONAS.findIndex((p) => p.id === id)
    const ingrid = wallets.address(idx("ingrid"))
    const buyers = ["hanse_kitchen", "fjord_processing"].map((id) => wallets.address(idx(id)))
    await runtime.bootstrap([...runtime.agents.values()].filter((a) => [ingrid, ...buyers].includes(a.agentId)))
    for (const a of runtime.agents.values()) if (![ingrid, ...buyers].includes(a.agentId)) runtime.patch(a.agentId, { paused: true })
    expect(await chain.balanceOf("EUR", buyers[0]!)).toBeGreaterThanOrEqual(toBase("20000"))
    const stopRuntime = runtime.watchOnly()

    const { lotId, auction } = await chain.createLot(ingrid, {
      sector: "fish", market: "fish_dock", commodity: "cod", grade: "fresh_a", place: "bergen", currency: "EUR",
      qty: 100n, floorPerUnit: toBase("7.50"), durationBlocks: 300n, pickupWindowBlocks: 3000n, parentLotId: 0n,
      seller: ingrid, metadataURI: "test://s2-3.1-live",
    })
    console.log(`lot ${lotId} auction ${auction}`)
    const lot = await chain.getLot(lotId)
    expect(lot).toMatchObject({ status: "open", spec: { commodity: "cod", currency: "EUR", qty: 100n } })

    while ((await chain.blockNumber()) < lot.endBlock - 20n) {
      await runtime.step()
      await sleep(3000)
    }
    const bids = runtime.log.filter((d) => d.result.status === "bid")
    console.log("decisions:", runtime.log.map((d) => `${d.result.status}${"reason" in d.result ? `(${d.result.reason.slice(0, 60)})` : ""}`).join(" | "))
    expect(bids.length).toBeGreaterThanOrEqual(2)

    while ((await chain.blockNumber()) < lot.endBlock) await sleep(2000)
    await (chain as unknown as { send: (a: unknown, r: unknown) => Promise<unknown> }).send(operator, {
      address: deployment.contracts.MarketSettlement as Address, abi: marketSettlementAbi, functionName: "settle", args: [lotId],
    })
    await sleep(8000)
    stopRuntime()
    stopWatch()

    const names = events.filter((e) => ("lotId" in e.args && e.args.lotId === lotId) || e.address === auction).map((e) => e.eventName)
    console.log("events:", names.join(", "))
    expect(names).toContain("LotListed")
    expect(names).toContain("BidSubmitted")
    expect(names).toContain("LotSettled")
    const after = await chain.getLot(lotId)
    console.log("settled:", after.status, after.settlement)
    expect(after.status).toBe("sold")
    expect(after.settlement!.soldUnits).toBeGreaterThan(0n)
  }, 300_000)
})
