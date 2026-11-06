import { toBase, type Currency, type Role } from "@fairtown/shared"
import type { Address, LocalAccount } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { FakeChain } from "../src/chain/fake/FakeChain"
import type { ChainEventName, EventArgs, LotSpecInput, ProtocolParams } from "../src/chain/types"

export const params: ProtocolParams = {
  feeBps: 100n,
  advanceNewBps: 5000,
  advanceProvenBps: 9000,
  advanceTruckBps: 1000,
  provenAfter: 3,
  contestWindowBlocks: 60n,
  reportWindowBlocks: 300n,
}

export function world() {
  const keys = new Map<Address, LocalAccount>()
  const chain = new FakeChain({ params, accountFor: (a) => keys.get(a) })
  const agent = async (role: Role, fund: Partial<Record<Currency, string>> = {}) => {
    const acct = privateKeyToAccount(generatePrivateKey())
    const addr = acct.address.toLowerCase() as Address
    keys.set(addr, acct)
    await chain.register(addr, role, role.toLowerCase())
    for (const [cur, amt] of Object.entries(fund)) await chain.mint(cur as Currency, addr, toBase(amt!))
    return addr
  }
  const events = <N extends ChainEventName>(name: N): EventArgs<N>[] =>
    chain.log.filter((e) => e.eventName === name).map((e) => e.args as EventArgs<N>)
  const last = <N extends ChainEventName>(name: N): EventArgs<N> => {
    const all = events(name)
    if (!all.length) throw new Error(`no ${name}`)
    return all[all.length - 1]!
  }
  const bid = async (from: Address, lotId: bigint, auction: Address, maxPerUnit: string, amount: string) => {
    await chain.ensurePermit2(from, "EUR", auction)
    return chain.submitBid(from, { lotId, maxPerUnit: toBase(maxPerUnit), amount: toBase(amount) })
  }
  return { chain, agent, events, last, bid, keys }
}

export const codSpec = (seller: Address, over: Partial<LotSpecInput> = {}): LotSpecInput => ({
  sector: "fish",
  market: "fish_dock",
  commodity: "cod",
  grade: "fresh_a",
  place: "bergen",
  currency: "EUR",
  qty: 600n,
  floorPerUnit: toBase("7.50"),
  durationBlocks: 45n,
  pickupWindowBlocks: 300n,
  parentLotId: 0n,
  seller,
  metadataURI: "", // an agent or director listing; lots from POST /api/listings/confirm carry /api/lots/meta/<draftId>
  ...over,
})

// Ingrid lists 600 kg cod; Hanse alone buys it all at 9.10.
export async function bergenSingle() {
  const w = world()
  const ingrid = await w.agent("SELLER")
  const hanse = await w.agent("BUYER", { EUR: "10000" })
  const oslo = await w.agent("BUYER", { EUR: "10000" })
  const { lotId, auction } = await w.chain.createLot(ingrid, codSpec(ingrid))
  await w.bid(hanse, lotId, auction, "9.10", "5460")
  w.chain.mine(45)
  return { ...w, ingrid, hanse, oslo, lotId, auction }
}
