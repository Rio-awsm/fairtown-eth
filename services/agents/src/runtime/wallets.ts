import { mnemonicToAccount, type HDAccount } from "viem/accounts"
import type { Address } from "viem"

// D-05: server-held demo keys from AGENT_MNEMONIC (testnet only, disclosed). Index = persona order, then custom buyers.
export class Wallets {
  private readonly accounts = new Map<number, HDAccount>()
  private readonly byAddress = new Map<string, HDAccount>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly mnemonic: string) {
    if (mnemonic.trim().split(/\s+/).length < 12) throw new Error("AGENT_MNEMONIC must be at least 12 words")
  }

  at(index: number): HDAccount {
    let a = this.accounts.get(index)
    if (!a) {
      a = mnemonicToAccount(this.mnemonic, { addressIndex: index })
      this.accounts.set(index, a)
      this.byAddress.set(a.address.toLowerCase(), a)
    }
    return a
  }
  address(index: number) {
    return this.at(index).address.toLowerCase() as Address
  }
  accountFor = (address: Address) => this.byAddress.get(address.toLowerCase())

  // One queue per wallet so a wallet's transactions never race each other's nonces.
  queue<T>(address: Address, f: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase()
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.then(f, f)
    this.queues.set(key, next.catch(() => undefined))
    return next
  }
}
