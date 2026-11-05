import type { Address } from "viem"
import type { ArkivStore } from "./arkiv/ArkivStore"
import { MemoryArkivStore } from "./arkiv/MemoryArkivStore"
import { FakeChain } from "./chain/fake/FakeChain"
import type { ChainAdapter } from "./chain/types"
import { protocolParams, type AgentsConfig } from "./config"

export const FAKE_BLOCK_MS = 2000

export function createAdapters(config: AgentsConfig): { chain: ChainAdapter; arkiv: ArkivStore; stop: () => void } {
  if (config.CHAIN_MODE !== "fake")
    throw new Error(`CHAIN_MODE=${config.CHAIN_MODE} needs ViemChain, which lands in S2 3.1. Use CHAIN_MODE=fake for now.`)
  if (config.ARKIV_MODE !== "memory")
    throw new Error("ARKIV_MODE=live needs LiveArkivStore, which lands in S2 2.1. Use ARKIV_MODE=memory for now.")
  const chain = new FakeChain({
    params: protocolParams(config),
    chainId: config.CHAIN_ID,
    treasury: config.TREASURY_ADDRESS as Address | undefined,
  })
  const stop = chain.autoMine(FAKE_BLOCK_MS)
  return { chain, arkiv: new MemoryArkivStore(), stop }
}
