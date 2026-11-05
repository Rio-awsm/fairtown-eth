import type { ColumnKind } from "@fairtown/shared/arkiv"
import type { Address, Hex } from "viem"

export type ArkivValue = string | bigint | Uint8Array
export type FilterValue = string | bigint
// A schema descriptor. The seven real ones live in @fairtown/shared/arkiv (ARKIV_SCHEMAS).
export type SchemaRef = {
  name: string
  indexed: readonly string[]
  columns?: Record<string, ColumnKind>
  flags?: { readonly: boolean; permissionlessExtension: boolean }
}
export type Range = { gt?: FilterValue; gte?: FilterValue; lt?: FilterValue; lte?: FilterValue }
export type Where = Record<string, FilterValue | Range>

export type Entity = {
  key: Hex
  schema: string
  owner: Address
  values: Record<string, ArkivValue>
  // Memory store: ms timestamp. Live store: Rabdi block number.
  expiresAt: number
}

export type PutOptions = {
  owner: Address
  expiresInSeconds: number
  key?: Hex
  // Idempotent create: if an entity owned by `owner` matches, return it instead of writing again.
  dedupe?: Where
}
export type QueryOptions = { limit?: number; orderBy?: { field: string; dir: "asc" | "desc" }; cursor?: string; owner?: Address }
export type QueryPage = { entities: Entity[]; cursor?: string }
// Like Arkiv's watch events: no attributes, and nothing is emitted when an entity expires.
export type ArkivEvent = { type: "created" | "updated" | "extended" | "deleted" | "transferred"; key: Hex; owner?: Address; at: number }

export type ArkivErrorCode =
  | "NotIndexed"
  | "LimitTooHigh"
  | "PayloadTooLarge"
  | "NotFound"
  | "NotOwner"
  | "BadCursor"
  | "ExpiryEarlier"
  | "Readonly"
  | "WriteFailed"
export class ArkivError extends Error {
  constructor(
    readonly code: ArkivErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = "ArkivError"
  }
}

export interface ArkivStore {
  readonly mode: "live" | "memory"
  put(schema: SchemaRef, values: Record<string, ArkivValue>, opts: PutOptions): Promise<{ key: Hex; reused?: boolean }>
  // Sets a new expiry `seconds` from now, like the SDK; moving it earlier is rejected.
  extend(key: Hex, seconds: number): Promise<{ expiresAt: number }>
  get(schema: SchemaRef, key: Hex): Promise<Entity | undefined>
  query(schema: SchemaRef, where: Where, opts?: QueryOptions): Promise<QueryPage>
  watch(handler: (e: ArkivEvent) => void): () => void
}

export const MAX_PAGE = 100
export const MAX_PAYLOAD = 100 * 1024
