import type { Persona } from "@fairtown/shared"
import type { FakeChain } from "./chain/fake/FakeChain"
import type { SellerDirectory } from "./sellers"

// Fake-mode stand-in for S2 3.1 bootstrap: register every persona and mark seeded proven sellers (disclosed).
export async function bootstrapFake(chain: FakeChain, sellers: SellerDirectory, personas: Persona[]) {
  for (const s of sellers.all()) await chain.register(s.address, s.role, s.name)
  for (const p of personas) if (p.seeded?.proven) chain.markProven(sellers.get(p.id)!.address, true)
}
