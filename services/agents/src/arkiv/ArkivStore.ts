import type { Address, Hex } from "viem"

export type ArkivValue = string | bigint
export type SchemaRef = { name: string; indexed: readonly string[] }
export type Range = { gt?: ArkivValue; gte?: ArkivValue; lt?: ArkivValue; lte?: ArkivValue }
export type Where = Record<string, ArkivValue | Range>

export type Entity = {
  key: Hex
  schema: string
  owner: Address
  values: Record<string, ArkivValue>
  payload?: Uint8Array
  expiresAt: number
}

export type PutOptions = { owner: Address; expiresInSeconds: number; key?: Hex; payload?: Uint8Array }
export type QueryOptions = { limit?: number; orderBy?: { field: string; dir: "asc" | "desc" }; cursor?: string }
export type QueryPage = { entities: Entity[]; cursor?: string }
// Like Arkiv's watch events: no attributes, and nothing is emitted when an entity expires.
export type ArkivEvent = { type: "created" | "updated" | "extended"; key: Hex; owner: Address; at: number }

export type ArkivErrorCode = "NotIndexed" | "LimitTooHigh" | "PayloadTooLarge" | "NotFound" | "NotOwner" | "BadCursor"
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
  put(schema: SchemaRef, values: Record<string, ArkivValue>, opts: PutOptions): Promise<{ key: Hex }>
  extend(key: Hex, seconds: number): Promise<{ expiresAt: number }>
  query(schema: SchemaRef, where: Where, opts?: QueryOptions): Promise<QueryPage>
  watch(handler: (e: ArkivEvent) => void): () => void
}
