import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { desc } from "@arkiv-network/sdk/query"
import { http } from "viem"
import { runLocal } from "./evaluate"
import type { Ledger } from "./mockLedger"
import { SCHEMAS } from "./schemas"
import type { LedgerQuery } from "./queries"

export type LedgerMode = "live" | "mock"
export type LedgerClient = { mode: LedgerMode; run(q: LedgerQuery): Promise<Record<string, unknown>[]> }

/** Fetched attributes are typed values (`{ type, value }`); the board reads plain bigint and string. */
export function unwrapRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v,
    ]),
  )
}

/**
 * Rabdi read client (source of truth 9.4). The access key ships to the browser, so limit its Origins
 * on hub.arkiv.network to the demo hosts (D-39).
 */
export function createLiveLedger(accessKey: string): LedgerClient {
  const client = createPublicClient({ chain: rabdi({ accessKey }), transport: http() })
  return {
    mode: "live",
    async run(q) {
      const base = client.select().from(SCHEMAS[q.entity])
      const filtered = q.where ? base.where(q.where as never) : base
      const page = await filtered
        .orderBy(desc("day") as never)
        .limit(q.limit)
        .fetch()
      return page.entities.map((e) => unwrapRow(e as Record<string, unknown>))
    },
  }
}

/** MOCK LEDGER: the same query, evaluated on the ledger built from the relay replay. */
export function createMockLedger(read: () => Ledger): LedgerClient {
  return { mode: "mock", run: async (q) => runLocal(q, read()) }
}
