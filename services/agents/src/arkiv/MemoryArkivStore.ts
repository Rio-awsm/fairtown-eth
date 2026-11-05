import { keccak256, toHex, type Address, type Hex } from "viem"
import {
  ArkivError,
  MAX_PAGE,
  MAX_PAYLOAD,
  type ArkivEvent,
  type ArkivStore,
  type ArkivValue,
  type Entity,
  type FilterValue,
  type PutOptions,
  type QueryOptions,
  type QueryPage,
  type Range,
  type SchemaRef,
  type Where,
} from "./ArkivStore"

const lc = (a: string) => a.toLowerCase() as Address
const cmp = (a: FilterValue, b: FilterValue) => (a === b ? 0 : a < b ? -1 : 1)
const isRange = (v: FilterValue | Range): v is Range => typeof v === "object"
const size = (values: Record<string, ArkivValue>) =>
  Object.values(values).reduce((n, v) => n + (v instanceof Uint8Array ? v.byteLength : String(v).length), 0)

function matches(value: ArkivValue | undefined, cond: FilterValue | Range): boolean {
  if (value === undefined || value instanceof Uint8Array) return false
  if (!isRange(cond)) return typeof value === typeof cond && value === cond
  for (const [op, bound] of Object.entries(cond) as [keyof Range, FilterValue][]) {
    if (typeof bound !== typeof value) return false
    const c = cmp(value, bound)
    if ((op === "gt" && c <= 0) || (op === "gte" && c < 0) || (op === "lt" && c >= 0) || (op === "lte" && c > 0)) return false
  }
  return true
}

type Stored = Entity & { readonly: boolean }

export class MemoryArkivStore implements ArkivStore {
  readonly mode = "memory" as const
  private readonly entities = new Map<Hex, Stored>()
  private readonly handlers = new Set<(e: ArkivEvent) => void>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  async put(schema: SchemaRef, values: Record<string, ArkivValue>, opts: PutOptions) {
    if (size(values) > MAX_PAYLOAD) throw new ArkivError("PayloadTooLarge")
    this.sweep()
    const at = this.now()
    const expiresAt = at + opts.expiresInSeconds * 1000
    if (opts.key) {
      const cur = this.entities.get(opts.key)
      if (!cur) throw new ArkivError("NotFound")
      if (cur.owner !== lc(opts.owner)) throw new ArkivError("NotOwner")
      if (cur.readonly) throw new ArkivError("Readonly")
      this.entities.set(opts.key, { ...cur, values: { ...cur.values, ...values } })
      this.notify({ type: "updated", key: opts.key, owner: cur.owner, at })
      return { key: opts.key }
    }
    if (opts.dedupe) {
      const prior = await this.query(schema, opts.dedupe, { limit: 1, owner: opts.owner })
      if (prior.entities[0]) return { key: prior.entities[0].key, reused: true }
    }
    const key = keccak256(toHex(`arkiv-memory-${++this.seq}`))
    this.entities.set(key, {
      key,
      schema: schema.name,
      owner: lc(opts.owner),
      values: { ...values },
      expiresAt,
      readonly: schema.flags?.readonly ?? false,
    })
    this.notify({ type: "created", key, owner: lc(opts.owner), at })
    return { key }
  }

  async extend(key: Hex, seconds: number) {
    this.sweep()
    const cur = this.entities.get(key)
    if (!cur) throw new ArkivError("NotFound")
    const next = this.now() + seconds * 1000
    if (next < cur.expiresAt) throw new ArkivError("ExpiryEarlier")
    cur.expiresAt = next
    this.notify({ type: "extended", key, owner: cur.owner, at: this.now() })
    return { expiresAt: cur.expiresAt }
  }

  async get(schema: SchemaRef, key: Hex) {
    this.sweep()
    const e = this.entities.get(key)
    return e && e.schema === schema.name ? this.view(e) : undefined
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
      (e) =>
        e.schema === schema.name &&
        (!opts.owner || e.owner === lc(opts.owner)) &&
        Object.entries(where).every(([f, c]) => matches(e.values[f], c)),
    )
    if (opts.orderBy) {
      const { field, dir } = opts.orderBy
      const sign = dir === "asc" ? 1 : -1
      rows = rows.sort((a, b) => sign * cmp((a.values[field] as FilterValue) ?? "", (b.values[field] as FilterValue) ?? ""))
    }
    const page = rows.slice(offset, offset + limit)
    const next = offset + limit < rows.length ? String(offset + limit) : undefined
    return { entities: page.map((e) => this.view(e)), ...(next ? { cursor: next } : {}) }
  }

  watch(handler: (e: ArkivEvent) => void) {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  private view({ readonly: _r, ...e }: Stored): Entity {
    void _r
    return { ...e, values: { ...e.values } }
  }
  private sweep() {
    const t = this.now()
    for (const [k, e] of this.entities) if (e.expiresAt <= t) this.entities.delete(k)
  }
  private notify(e: ArkivEvent) {
    for (const h of this.handlers) h(e)
  }
}
