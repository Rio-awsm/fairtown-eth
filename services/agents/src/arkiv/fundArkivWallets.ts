import { rabdi } from "@arkiv-network/sdk/chains"
import { createPublicClient, createWalletClient, http, type Address, type LocalAccount } from "viem"

export type FundResult = { address: Address; before: bigint; sent: bigint; tx?: string }

// Tops up agent wallets so they can own their Arkiv entities. Sends only to wallets below `minBalance`.
export async function fundArkivWallets(o: { accessKey: string; from: LocalAccount; to: Address[]; topUpTo: bigint; minBalance: bigint }) {
  const chain = rabdi({ accessKey: o.accessKey })
  const reader = createPublicClient({ chain, transport: http() })
  const wallet = createWalletClient({ account: o.from, chain, transport: http() })
  const out: FundResult[] = []
  for (const address of o.to) {
    const before = await reader.getBalance({ address })
    if (before >= o.minBalance) {
      out.push({ address, before, sent: 0n })
      continue
    }
    const value = o.topUpTo - before
    const tx = await wallet.sendTransaction({ to: address, value, chain })
    await reader.waitForTransactionReceipt({ hash: tx })
    out.push({ address, before, sent: value, tx })
  }
  return out
}
