import { formatUnits, type Address, type Hex } from "viem"
import type { TownEvent } from "@fairtown/shared"
import type { ChainEvent } from "../../chain/types"
import type { Persona } from "@fairtown/shared"
import type { RuntimeAgent } from "../../runtime/types"
import type { EnsClient, EnsState, Records } from "./client"
import { labelFor, ROLE } from "./contracts"

export type EnsPort = Pick<EnsClient, "registerSub" | "setRecords" | "revokeRole" | "ownerOf" | "text">
export type SellerEns = { name: string; verified: boolean; detail: string }

const lc = (a: string) => a.toLowerCase() as Address
const ZERO = "0x0000000000000000000000000000000000000000"
const DAY = 86_400n
// "fairtown.verified" record and the name-level SET_RESOLVER role are the seller's verified mark; a no-show removes both.
export const VERIFIED_KEY = "fairtown.verified"
export const VERIFIED_ROLE = ROLE.SET_RESOLVER
const SELLING = new Set(["SELLER", "TRUCK", "STORAGE"])

export function mandateSummary(a: Pick<RuntimeAgent, "mandate" | "currency">): string {
  const m = a.mandate
  if (!m) return ""
  const sym = a.currency === "EUR" ? "€" : "$"
  return `${m.commodities.join(", ")} up to ${sym}${formatUnits(BigInt(m.maxPerUnit), 6)} per unit${m.qty ? `, ${m.qty} units` : ""}${m.place ? ` at ${m.place}` : ""}`
}

// ENS agent names (guide 8.2). Every agent is <label>.<parent> on ENSv2 Sepolia, owned by its own wallet, with records on our
// resolver. Walk-ins and trucks get expiring names; a no-show revokes the seller's verified role. Behind ADDON_ENS.
export class EnsAgents {
  readonly names = new Map<Address, string>()
  readonly log: string[] = []
  private readonly revoked = new Set<Address>()
  private readonly cache = new Map<Address, { at: number; v: SellerEns }>()
  private q: Promise<void> = Promise.resolve()

  constructor(
    private readonly o: {
      ens: EnsPort
      state: EnsState
      personas: Persona[]
      publish?: (events: TownEvent[]) => Promise<void>
      now?: () => number // ms
      cacheMs?: number
      onError?: (what: string, e: unknown) => void
    },
  ) {}

  nameOf(a: Address) {
    return this.names.get(lc(a))
  }
  private now() {
    return this.o.now?.() ?? Date.now()
  }
  private persona(a: RuntimeAgent) {
    return a.personaId ? this.o.personas.find((p) => p.id === a.personaId) : undefined
  }

  expiryFor(a: RuntimeAgent): bigint {
    const now = BigInt(Math.floor(this.now() / 1000))
    if (a.manual) return now + 2n * 3600n // walk-in session
    if (a.role === "TRUCK") return now + 3n * DAY
    return now + 365n * DAY
  }

  records(a: RuntimeAgent): Records {
    const p = this.persona(a)
    return {
      description: p?.bio ?? (a.manual ? `Walk-in visitor ${a.name} (2-hour name)` : a.name),
      "fairtown.role": a.role,
      "fairtown.building": a.building,
      ...(a.mandate ? { "fairtown.mandate": mandateSummary(a) } : {}),
      ...(SELLING.has(a.role) ? { [VERIFIED_KEY]: "true" } : {}),
      // The public seller record lives on Arkiv (arkiv/queries.md); this is the query anyone can run.
      "fairtown.reputation": `arkiv:fairtown.v1.reputation where seller = ${a.agentId}`,
    }
  }

  // Idempotent: an existing name owned by the agent keeps its records.
  register(a: RuntimeAgent, label = labelFor(a.manual ? `${a.name}-${a.agentId.slice(2, 6)}` : (a.personaId ?? a.name))) {
    const run = async () => {
      const name = `${label}.${this.o.state.parent}`
      try {
        const owner = await this.o.ens.ownerOf(this.o.state, label)
        if (lc(owner) === lc(a.agentId)) {
          this.names.set(lc(a.agentId), name)
          return name
        }
        if (owner !== ZERO) throw new Error(`${name} belongs to ${owner}`)
        await this.o.ens.registerSub(this.o.state, label, a.agentId, this.expiryFor(a), SELLING.has(a.role) ? VERIFIED_ROLE : 0n)
        await this.o.ens.setRecords(this.o.state, name, this.records(a), a.agentId)
        this.names.set(lc(a.agentId), name)
        this.log.push(`registered ${name}`)
        await this.o.publish?.([{ type: "agent.spawned", agentId: a.agentId, name: a.name, role: a.role, building: a.building, sprite: a.sprite, ensName: name }])
        return name
      } catch (e) {
        this.o.onError?.(`register ${name}`, e)
        return undefined
      }
    }
    const p = this.q.then(run, run)
    this.q = p.then(() => undefined)
    return p
  }

  idle() {
    return this.q
  }

  // A finalized no-show (SellerRecordUpdated with noShows > 0) revokes the verified role and says why, once per seller.
  onEvent(e: ChainEvent) {
    if (e.eventName !== "SellerRecordUpdated" || e.args.noShows === 0) return
    const seller = lc(e.args.seller)
    const name = this.names.get(seller)
    if (!name || this.revoked.has(seller)) return
    this.revoked.add(seller)
    const label = name.slice(0, -(this.o.state.parent.length + 1))
    const run = async () => {
      try {
        await this.o.ens.revokeRole(this.o.state, label, VERIFIED_ROLE, seller)
        await this.o.ens.setRecords(this.o.state, name, { [VERIFIED_KEY]: `revoked: ${e.args.noShows} no-show(s), tx ${e.transactionHash as Hex}` })
        this.cache.delete(seller)
        this.log.push(`revoked ${name}`)
      } catch (err) {
        this.revoked.delete(seller)
        this.o.onError?.(`revoke ${name}`, err)
      }
    }
    this.q = this.q.then(run, run)
  }

  // Buyer agents resolve the seller's name before bidding (through ENS, cached briefly). No name means no ENS opinion.
  async sellerCheck(seller: Address): Promise<SellerEns | undefined> {
    const name = this.names.get(lc(seller))
    if (!name) return undefined
    const hit = this.cache.get(lc(seller))
    if (hit && this.now() - hit.at < (this.o.cacheMs ?? 60_000)) return hit.v
    try {
      const v = await this.o.ens.text(name, VERIFIED_KEY)
      const r: SellerEns = { name, verified: !v || !v.startsWith("revoked"), detail: v ?? "no record" }
      this.cache.set(lc(seller), { at: this.now(), v: r })
      return r
    } catch (e) {
      this.o.onError?.(`resolve ${name}`, e)
      return hit?.v // ENS down: keep the last answer, or none
    }
  }
}
