import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, desc, eq, gte, type Expression } from "@arkiv-network/sdk/query"
import { str, u64 } from "@arkiv-network/sdk/schema"
import { http } from "viem"
import type { ReputationRow } from "./mockLedger"
import { SCHEMAS } from "./schemas"

/** One product query (source of truth 9.3): which entity, its filter, newest first, a page size. */
export type LedgerQuery = { entity: keyof typeof SCHEMAS; where?: Expression; limit: number }

const combine = (parts: Expression[]): Expression | undefined =>
  parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : and(...parts)

/** Prices: by commodity, place, market and since a day. With no filter, all clears. */
export function clearsFor(f: {
  commodity?: string
  place?: string
  market?: string
  sinceDay?: number
  limit?: number
}): LedgerQuery {
  const parts: Expression[] = []
  if (f.commodity) parts.push(eq("commodity", str(f.commodity)))
  if (f.place) parts.push(eq("place", str(f.place)))
  if (f.market) parts.push(eq("market", str(f.market)))
  if (f.sinceDay !== undefined) parts.push(gte("day", u64(f.sinceDay)))
  const where = combine(parts)
  return { entity: "price", ...(where ? { where } : {}), limit: f.limit ?? 20 }
}
export const allClears = (limit = 20): LedgerQuery => ({ entity: "price", limit })
export const sellerRecord = (seller: string): LedgerQuery => ({
  entity: "reputation",
  where: eq("seller", str(seller.toLowerCase())),
  limit: 20,
})
export const allReputations = (): LedgerQuery => ({ entity: "reputation", limit: 100 })

// Builds query text only: `toString()` never touches the network.
const textClient = createPublicClient({ chain: rabdi({ accessKey: "query-text-only" }), transport: http() })

/** Exactly the text the node receives, from the SDK itself (never hand-written). */
export function queryText(q: LedgerQuery): string {
  const base = textClient.select({ $key: true }).from(SCHEMAS[q.entity])
  const filtered = q.where ? base.where(q.where as never) : base
  return filtered.orderBy(desc("day") as never).toString()
}

/** Latest record per seller (readers use the latest by day: contract 10). */
export function latestReputations(rows: ReputationRow[]): ReputationRow[] {
  const latest = new Map<string, ReputationRow>()
  for (const r of rows) {
    const seen = latest.get(r.seller)
    if (!seen || r.day >= seen.day) latest.set(r.seller, r)
  }
  return [...latest.values()]
}
