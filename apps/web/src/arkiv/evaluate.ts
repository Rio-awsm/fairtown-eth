import type { Expression } from "@arkiv-network/sdk/query"
import type { Ledger } from "./mockLedger"
import type { LedgerQuery } from "./queries"

type Cmp = -1 | 0 | 1
function compare(a: unknown, b: unknown): Cmp | null {
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0
  return null
}

/** Evaluates an SDK query expression against one row, the same way the node filters (mock mode). */
export function evaluate(expr: Expression, row: Record<string, unknown>): boolean {
  switch (expr.kind) {
    case "and":
      return expr.expressions.every((e) => evaluate(e, row))
    case "or":
      return expr.expressions.some((e) => evaluate(e, row))
    case "exists":
      return row[expr.name] !== undefined
    case "startsWith": {
      const v = row[expr.name]
      return typeof v === "string" && v.startsWith(String(expr.value.value))
    }
    case "between": {
      const v = row[expr.name]
      const lo = compare(v, expr.low.value)
      const hi = compare(v, expr.high.value)
      return lo !== null && hi !== null && lo >= 0 && hi <= 0
    }
    case "comparison": {
      const c = compare(row[expr.name], expr.value.value)
      if (c === null) return false
      return { "=": c === 0, "<": c < 0, "<=": c <= 0, ">": c > 0, ">=": c >= 0 }[expr.operator]
    }
    default:
      return false
  }
}

/** Runs a product query on the mock ledger: filter, newest day first, page size. */
export function runLocal(q: LedgerQuery, ledger: Ledger): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = ledger[q.entity]
  return rows
    .filter((r) => !q.where || evaluate(q.where, r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const d = (b.r.day as bigint) - (a.r.day as bigint)
      return d === 0n ? b.i - a.i : d > 0n ? 1 : -1
    })
    .slice(0, q.limit)
    .map(({ r }) => r)
}
