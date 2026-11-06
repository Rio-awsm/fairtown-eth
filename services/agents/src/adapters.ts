import { privateKeyToAccount } from "viem/accounts"
import type { Address, Hex, LocalAccount } from "viem"
import type { ArkivStore } from "./arkiv/ArkivStore"
import { LiveArkivStore } from "./arkiv/LiveArkivStore"
import { MemoryArkivStore } from "./arkiv/MemoryArkivStore"
import { loadDeployment } from "@fairtown/shared/addresses"
import { FakeChain } from "./chain/fake/FakeChain"
import { ViemChain } from "./chain/viem/ViemChain"
import type { ChainAdapter } from "./chain/types"
import { protocolParams, type AgentsConfig } from "./config"

export const FAKE_BLOCK_MS = 2000

export const writerAccount = (pk: string): LocalAccount => privateKeyToAccount((pk.trim().startsWith("0x") ? pk.trim() : `0x${pk.trim()}`) as Hex)

export function createArkiv(config: AgentsConfig, onFriction?: (n: string) => void): { arkiv: ArkivStore; writer: Address } {
  if (config.ARKIV_MODE === "memory") return { arkiv: new MemoryArkivStore(), writer: "0x00000000000000000000000000000000000000ee" }
  if (!config.ARKIV_ACCESS_KEY || !config.ARKIV_PRIVATE_KEY)
    throw new Error("ARKIV_MODE=live needs ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY")
  const writer = writerAccount(config.ARKIV_PRIVATE_KEY)
  return { arkiv: new LiveArkivStore({ accessKey: config.ARKIV_ACCESS_KEY, writer, onFriction }), writer: writer.address }
}

export type Adapters = { chain: ChainAdapter; arkiv: ArkivStore; writer: Address; stop: () => void; fake?: FakeChain; viem?: ViemChain }

export async function createAdapters(config: AgentsConfig, accountFor?: (a: Address) => LocalAccount | undefined): Promise<Adapters> {
  const { arkiv, writer } = createArkiv(config)
  if (config.CHAIN_MODE !== "fake") {
    if (!config.OPERATOR_PRIVATE_KEY || !config.RPC_URL || !accountFor)
      throw new Error(`CHAIN_MODE=${config.CHAIN_MODE} needs OPERATOR_PRIVATE_KEY, RPC_URL and AGENT_MNEMONIC`)
    const deployment = await loadDeployment(config.CHAIN_MODE)
    const viem = new ViemChain({ deployment, rpcUrl: config.RPC_URL, operator: writerAccount(config.OPERATOR_PRIVATE_KEY), accountFor })
    return { chain: viem, arkiv, writer, stop: () => {}, viem }
  }
  const chain = new FakeChain({
    params: protocolParams(config),
    chainId: config.CHAIN_ID,
    treasury: config.TREASURY_ADDRESS as Address | undefined,
    ...(accountFor ? { accountFor } : {}),
  })
  return { chain, arkiv, writer, stop: () => {}, fake: chain }
}
