import type { Persona, Role } from "@fairtown/shared"
import type { Address } from "viem"

export type SellerEntry = { id: string; name: string; role: Role; address: Address; persona: Persona }

// Maps persona ids to wallet addresses. Until S2 3.1 adds HD wallets, the fixture ids stand in.
export class SellerDirectory {
  private readonly byId = new Map<string, SellerEntry>()
  private readonly byAddress = new Map<string, SellerEntry>()

  constructor(personas: Persona[], addressOf: (p: Persona) => Address = (p) => p.fixtureAgentId as Address) {
    for (const p of personas) {
      const e: SellerEntry = { id: p.id, name: p.name, role: p.role, address: addressOf(p).toLowerCase() as Address, persona: p }
      this.byId.set(p.id, e)
      this.byAddress.set(e.address, e)
    }
  }
  get(id: string) {
    return this.byId.get(id)
  }
  byAddr(address: string) {
    return this.byAddress.get(address.toLowerCase())
  }
  all() {
    return [...this.byId.values()]
  }
}
