import { keccak256, toHex, type Address, type Hex } from "viem"
import {
  ArkivError,
  type ArkivEvent,
  type ArkivStore,
  type ArkivValue,
  type Entity,
  type PutOptions,
  type QueryOptions,
  type QueryPage,
  type Range,
  type SchemaRef,
  type Where,
} from "./ArkivStore"

const MAX_PAGE = 100
const MAX_PAYLOAD = 100 * 1024
const lc = (a: string) => a.toLowerCase() as Address

const cmp = (a: ArkivValue, b: ArkivValue) => (a === b ? 0 : a < b ? -1 : 1)
const isRange = (v: ArkivValue | Range): v is Range => typeof v === "object"

function matches(value: ArkivValue | undefined, cond: ArkivValue | Range): boolean {
  if (value === undefined) return false
  if (!isRange(cond)) return typeof value === typeof cond && value === cond
  for (const [op, bound] of Object.entries(cond) as [keyof Range, ArkivValue][]) {
    if (typeof bound !== typeof value) return false
    const c = cmp(value, bound)
    if ((op === "gt" && c <= 0) || (op === "gte" && c < 0) || (op === "lt" && c >= 0) || (op === "lte" && c > 0)) return false
  }
  return true
}

export class MemoryArkivStore implements ArkivStore {
  readonly mode = "memory" as const
  private readonly entities = new Map<Hex, Entity>()
  private readonly handlers = new Set<(e: ArkivEvent) => void>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  async put(schema: SchemaRef, values: Record<string, ArkivValue>, opts: PutOptions) {
    if ((opts.payload?.byteLength ?? 0) > MAX_PAYLOAD) throw new ArkivError("PayloadTooLarge")
    this.sweep()
    const at = this.now()
    const expiresAt = at + opts.expiresInSeconds * 1000
    if (opts.key) {
      const cur = this.entities.get(opts.key)
      if (!cur) throw new ArkivError("NotFound")
      if (cur.owner !== lc(opts.owner)) throw new ArkivError("NotOwner")
      this.entities.set(opts.key, { ...cur, values: { ...values }, payload: opts.payload, expiresAt })
      this.notify({ type: "updated", key: opts.key, owner: cur.owner, at })
      return { key: opts.key }
    }
    const key = keccak256(toHex(`arkiv-memory-${++this.seq}`))
    this.entities.set(key, { key, schema: schema.name, owner: lc(opts.owner), values: { ...values }, payload: opts.payload, expiresAt })
    this.notify({ type: "created", key, owner: lc(opts.owner), at })
    return { key }
  }

  async extend(key: Hex, seconds: number) {
    this.sweep()
    const cur = this.entities.get(key)
    if (!cur) throw new ArkivError("NotFound")
    cur.expiresAt += seconds * 1000
    this.notify({ type: "extended", key, owner: cur.owner, at: this.now() })
    return { expiresAt: cur.expiresAt }
  }

  async query(schema: SchemaRef, where: Where, opts: QueryOptions = {}): Promise<QueryPage> {
    const limit = opts.limit ?? MAX_PAGE
    if (limit > MAX_PAGE) throw new ArkivError("LimitTooHigh", `Pages hold at most ${MAX_PAGE} rows`)
    for (const field of [...Object.keys(where), ...(opts.orderBy ? [opts.orderBy.field] : [])])
      if (!schema.indexed.includes(field)) throw new ArkivError("NotIndexed", `${schema.name}.${field} is not indexed`)
    const offset = opts.cursor === undefined ? 0 : Number(opts.cursor)
    if (!Number.isInteger(offset) || offset < 0) throw new ArkivError("BadCursor")
    this.sweep()
    let rows = [...this.entities.values()].filter(
      (e) => e.schema === schema.name && Object.entries(where).every(([f, c]) => matches(e.values[f], c)),
    )
    if (opts.orderBy) {
      const { field, dir } = opts.orderBy
      const sign = dir === "asc" ? 1 : -1
      rows = rows.sort((a, b) => sign * cmp(a.values[field] ?? "", b.values[field] ?? ""))
    }
    const page = rows.slice(offset, offset + limit)
    const next = offset + limit < rows.length ? String(offset + limit) : undefined
    return { entities: page.map((e) => ({ ...e, values: { ...e.values } })), ...(next ? { cursor: next } : {}) }
  }

  watch(handler: (e: ArkivEvent) => void) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  private sweep() {
    const t = this.now()
    for (const [k, e] of this.entities) if (e.expiresAt <= t) this.entities.delete(k)
  }
  private notify(e: ArkivEvent) {
    for (const h of this.handlers) h(e)
  }
}
