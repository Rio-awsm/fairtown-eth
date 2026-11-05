import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, asc, desc, eq, gt, gte, lt, lte } from "@arkiv-network/sdk/query"
import { addr, u256, u64, type Schema } from "@arkiv-network/sdk/schema"
import { ARKIV_SCHEMAS, ARKIV_SDK_SCHEMAS, RABDI_CHAIN_ID, type ColumnKind } from "@fairtown/shared/arkiv"
import { bytesToHex, hexToBytes, http, type Address, type Hex, type LocalAccount } from "viem"
import {
  ArkivError,
  MAX_PAGE,
  type ArkivEvent,
  type ArkivStore,
  type ArkivValue,
  type Entity,
  type FilterValue,
  type PutOptions,
  type QueryOptions,
  type QueryPage,
  type SchemaRef,
  type Where,
} from "./ArkivStore"

// Rabdi policy from the Arkiv skills: explicit gas of at least 1,000,000 per single write.
const GAS = 1_500_000n
const lc = (a: string) => a.toLowerCase() as Address
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type LiveArkivOptions = {
  accessKey: string
  writer: LocalAccount
  // Agent wallets that own their own entities. Owners without a signer fall back to the writer (logged).
  signerFor?: (owner: Address) => LocalAccount | undefined
  onFriction?: (note: string) => void
}

type AnyQuery = {
  where(e: unknown): AnyQuery
  ownedBy(a: Address): AnyQuery
  orderBy(o: unknown): AnyQuery
  limit(n: number): AnyQuery
  offset(n: number): AnyQuery
  fetch(): Promise<{ entities: Array<Record<string, unknown>> }>
}

export class LiveArkivStore implements ArkivStore {
  readonly mode = "live" as const
  readonly reader
  private readonly chain
  private readonly wallets = new Map<string, ReturnType<typeof createWalletClient>>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly opts: LiveArkivOptions
  fallbacks = 0

  constructor(opts: LiveArkivOptions) {
    this.opts = opts
    this.chain = rabdi({ accessKey: opts.accessKey })
    this.reader = createPublicClient({ chain: this.chain, transport: http(undefined, { retryCount: 1, timeout: 15_000 }) })
  }

  async checkChain() {
    const id = await this.reader.getChainId()
    if (id !== RABDI_CHAIN_ID) throw new ArkivError("WriteFailed", `Arkiv RPC is chain ${id}, expected ${RABDI_CHAIN_ID}`)
    return { chainId: id, writer: this.opts.writer.address, balance: await this.reader.getBalance({ address: this.opts.writer.address }) }
  }

  async put(schema: SchemaRef, values: Record<string, ArkivValue>, opts: PutOptions) {
    const sdk = this.sdkSchema(schema)
    const account = this.accountFor(opts.owner)
    const wallet = this.walletFor(account)
    const wrapped = this.wrap(schema, values)
    if (opts.key) {
      const key = opts.key
      await this.serial(account.address, () =>
        wallet.patchEntity(sdk, key, { set: wrapped } as never, { gas: GAS }),
      )
      return { key }
    }
    const dedupe = async () =>
      opts.dedupe ? (await this.query(schema, opts.dedupe, { limit: 1, owner: account.address })).entities[0] : undefined
    const prior = await dedupe()
    if (prior) return { key: prior.key, reused: true }
    const create = () =>
      this.serial(account.address, () =>
        wallet.createEntity(
          sdk,
          wrapped as never,
          { expiration: ExpirationTime.fromSeconds(Math.max(60, Math.floor(opts.expiresInSeconds))), flags: schema.flags },
          { gas: GAS },
        ),
      )
    try {
      const r = await create()
      return { key: r.entityKey }
    } catch (e) {
      this.opts.onFriction?.(`create ${schema.name} failed once: ${short(e)}`)
      // The write may have landed. Check by key before rewriting.
      await sleep(2500)
      const landed = await dedupe()
      if (landed) return { key: landed.key, reused: true }
      try {
        const r = await create()
        return { key: r.entityKey }
      } catch (e2) {
        throw new ArkivError("WriteFailed", `${schema.name}: ${short(e2)}`)
      }
    }
  }

  async extend(key: Hex, seconds: number) {
    const account = this.opts.writer
    const r = await this.serial(account.address, () =>
      this.walletFor(account).extendEntity({ entityKey: key, expiration: ExpirationTime.fromSeconds(seconds) }, { gas: GAS }),
    )
    return { expiresAt: Number(r.expiresAt) }
  }

  async get(schema: SchemaRef, key: Hex) {
    try {
      const e = (await this.reader.getEntity(key, this.sdkSchema(schema))) as unknown as Record<string, unknown>
      return this.unwrap(schema, e)
    } catch {
      return undefined
    }
  }

  async query(schema: SchemaRef, where: Where, opts: QueryOptions = {}): Promise<QueryPage> {
    const limit = opts.limit ?? MAX_PAGE
    if (limit > MAX_PAGE) throw new ArkivError("LimitTooHigh", `Pages hold at most ${MAX_PAGE} rows`)
    for (const field of [...Object.keys(where), ...(opts.orderBy ? [opts.orderBy.field] : [])])
      if (!schema.indexed.includes(field)) throw new ArkivError("NotIndexed", `${schema.name}.${field} is not indexed`)
    const offset = opts.cursor === undefined ? 0 : Number(opts.cursor)
    if (!Number.isInteger(offset) || offset < 0) throw new ArkivError("BadCursor")
    const columns = this.columns(schema)
    const select: Record<string, true> = { $key: true, $owner: true, $expiresAt: true }
    for (const c of Object.keys(columns)) select[c] = true
    const exprs = Object.entries(where).flatMap(([field, cond]) => {
      const v = (x: FilterValue) => this.filterValue(columns[field]!, x)
      if (typeof cond !== "object") return [eq(field, v(cond))]
      const out = []
      if (cond.gt !== undefined) out.push(gt(field, v(cond.gt)))
      if (cond.gte !== undefined) out.push(gte(field, v(cond.gte)))
      if (cond.lt !== undefined) out.push(lt(field, v(cond.lt)))
      if (cond.lte !== undefined) out.push(lte(field, v(cond.lte)))
      return out
    })
    let q = (this.reader.select(select as never) as unknown as { from(s: Schema): AnyQuery }).from(this.sdkSchema(schema))
    if (exprs.length) q = q.where(exprs.length === 1 ? exprs[0] : and(...exprs))
    if (opts.owner) q = q.ownedBy(opts.owner)
    if (opts.orderBy) q = q.orderBy(opts.orderBy.dir === "asc" ? asc(opts.orderBy.field) : desc(opts.orderBy.field))
    // Rabdi pages hold at most 100 rows, so a full page means "maybe more" (the next page may be empty).
    const { entities } = await q.limit(limit).offset(offset).fetch()
    const page = entities.map((e) => this.unwrap(schema, e)!)
    return { entities: page, ...(entities.length === limit ? { cursor: String(offset + limit) } : {}) }
  }

  watch(handler: (e: ArkivEvent) => void) {
    const types = { EntityCreated: "created", EntityPatched: "updated", ExpiryExtended: "extended", EntityDeleted: "deleted", OwnershipTransferred: "transferred" } as const
    return this.reader.watchEntityEvents({
      onEvent: (ev) =>
        handler({
          type: types[ev.type],
          key: ev.entityKey,
          ...("owner" in ev ? { owner: lc(ev.owner) } : { owner: lc(ev.newOwner) }),
          at: Number(ev.blockNumber),
        }),
      onError: (err) => this.opts.onFriction?.(`watch error: ${short(err)}`),
    })
  }

  // ---------- helpers ----------
  private accountFor(owner: Address): LocalAccount {
    if (lc(owner) === lc(this.opts.writer.address)) return this.opts.writer
    const own = this.opts.signerFor?.(lc(owner))
    if (own) return own
    this.fallbacks++
    return this.opts.writer
  }
  private walletFor(account: LocalAccount) {
    let w = this.wallets.get(account.address)
    if (!w) {
      w = createWalletClient({ account, chain: this.chain, transport: http(undefined, { retryCount: 0, timeout: 30_000 }) })
      this.wallets.set(account.address, w)
    }
    return w
  }
  // One queue per wallet keeps nonces in order.
  private serial<T>(address: string, f: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(address) ?? Promise.resolve()
    const next = prev.then(f, f)
    this.queues.set(address, next.catch(() => undefined))
    return next
  }
  private columns(schema: SchemaRef): Record<string, ColumnKind> {
    if (!schema.columns) throw new ArkivError("WriteFailed", `${schema.name} has no column kinds; use ARKIV_SCHEMAS`)
    return schema.columns
  }
  private sdkSchema(schema: SchemaRef): Schema {
    const k = (Object.keys(ARKIV_SCHEMAS) as Array<keyof typeof ARKIV_SCHEMAS>).find((n) => ARKIV_SCHEMAS[n].name === schema.name)
    if (!k) throw new ArkivError("WriteFailed", `Unknown Arkiv schema ${schema.name}`)
    return ARKIV_SDK_SCHEMAS[k]
  }
  // Predicates must carry the column's type: a bare bigint is read as u256 and never matches a u64 column.
  private filterValue(kind: ColumnKind, v: FilterValue) {
    if (kind === "addr") return addr(lc(String(v)))
    if (kind === "u64") return u64(v as bigint)
    if (kind === "u256") return u256(v as bigint)
    return v
  }
  private wrap(schema: SchemaRef, values: Record<string, ArkivValue>) {
    const cols = this.columns(schema)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) {
      const kind = cols[k]
      if (!kind) throw new ArkivError("WriteFailed", `${schema.name} has no column ${k}`)
      out[k] =
        kind === "addr" ? addr(String(v)) : kind === "u64" ? u64(v as bigint) : kind === "u256" ? u256(v as bigint) : v
    }
    return out
  }
  private unwrap(schema: SchemaRef, e: Record<string, unknown>): Entity | undefined {
    if (!e) return undefined
    const cols = this.columns(schema)
    const values: Record<string, ArkivValue> = {}
    for (const [k, kind] of Object.entries(cols)) {
      const cell = e[k] as { value?: unknown } | undefined
      if (!cell || cell.value === undefined) continue
      const v = cell.value
      values[k] =
        kind === "bytes"
          ? typeof v === "string" ? hexToBytes(v as Hex) : (v as Uint8Array)
          : kind === "u64" || kind === "u256"
            ? BigInt(v as bigint)
            : kind === "addr"
              ? lc(String(v))
              : String(v)
    }
    return {
      key: e.$key as Hex,
      schema: schema.name,
      owner: lc(String(e.$owner)),
      values,
      expiresAt: Number(e.$expiresAt ?? 0),
    }
  }
}

function short(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  // Keyed RPC URLs carry the access key in the path; never let one reach logs.
  return msg.replace(/https?:\/\/\S+/g, "<rpc>").slice(0, 240)
}

export { bytesToHex }
