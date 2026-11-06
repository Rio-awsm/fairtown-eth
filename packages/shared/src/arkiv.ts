import { addr, bytes, defineSchema, str, u256, u64, type Columns, type Schema } from "@arkiv-network/sdk/schema"

// Contract section 10. Namespace fairtown.v1., network Rabdi, SDK 1.0.x.
export const ARKIV_NAMESPACE = "fairtown.v1."
export const RABDI_CHAIN_ID = 7794095

export type ColumnKind = "str" | "addr" | "u64" | "u256" | "bytes"
export type ArkivSchemaDef = {
  name: string
  columns: Record<string, ColumnKind>
  indexed: readonly string[]
  owner: "seller" | "buyer" | "writer" | "truck_or_storage" | "agent"
  flags: { readonly: boolean; permissionlessExtension: boolean }
}

const def = <const C extends Record<string, ColumnKind>>(
  short: string,
  columns: C,
  indexed: readonly (keyof C & string)[],
  owner: ArkivSchemaDef["owner"],
  flags: ArkivSchemaDef["flags"] = { readonly: false, permissionlessExtension: false },
) => ({ name: `${ARKIV_NAMESPACE}${short}`, columns, indexed, owner, flags }) satisfies ArkivSchemaDef

export const ARKIV_SCHEMAS = {
  lot: def(
    "lot",
    {
      sector: "str",
      commodity: "str",
      grade: "str",
      market: "str",
      place: "str",
      currency: "str",
      status: "str",
      lotId: "u256",
      auction: "addr",
      floorPerUnit: "u256",
      endBlock: "u64",
      parentLotId: "u256",
      details: "bytes",
    },
    ["sector", "commodity", "grade", "market", "place", "currency", "status", "lotId", "auction", "floorPerUnit", "endBlock", "parentLotId"],
    "seller",
  ),
  bid: def(
    "bid",
    { lotId: "u256", agent: "addr", maxPerUnit: "u256", amount: "u256", block: "u64", reason: "str" },
    ["lotId", "agent", "maxPerUnit", "amount", "block"],
    "buyer",
  ),
  price: def(
    "price",
    {
      sector: "str",
      commodity: "str",
      grade: "str",
      market: "str",
      place: "str",
      currency: "str",
      lotId: "u256",
      finalClearingPerUnit: "u256",
      avgPerUnit: "u256",
      soldUnits: "u256",
      day: "str",
      tx: "str",
    },
    ["sector", "commodity", "grade", "market", "place", "currency", "lotId", "finalClearingPerUnit", "avgPerUnit", "soldUnits", "day"],
    "writer",
    { readonly: true, permissionlessExtension: true },
  ),
  reputation: def(
    "reputation",
    { seller: "addr", tier: "str", cleanLots: "u64", noShows: "u64", day: "str", lastLotId: "u256", tx: "str" },
    ["seller", "tier", "cleanLots", "noShows", "day"],
    "writer",
    { readonly: true, permissionlessExtension: true },
  ),
  capacity: def(
    "capacity",
    { kind: "str", fromMarket: "str", toPlace: "str", qty: "u256", readyByBlock: "u64", lotId: "u256", notes: "str" },
    ["kind", "fromMarket", "toPlace", "qty", "readyByBlock", "lotId"],
    "truck_or_storage",
  ),
  signal: def(
    "signal",
    { kind: "str", place: "str", severity: "u64", expiresAtBlock: "u64", label: "str" },
    ["kind", "place", "severity", "expiresAtBlock"],
    "writer",
  ),
  agent: def(
    "agent",
    { role: "str", name: "str", building: "str", mandate: "bytes" },
    ["role", "name", "building"],
    "agent",
    { readonly: false, permissionlessExtension: true },
  ),
} as const

export type ArkivSchemaName = keyof typeof ARKIV_SCHEMAS

const COLUMN = { str, addr, u64, u256, bytes } as const

// SDK schemas built from the descriptors above, so both stores share one definition.
function toSdk(d: ArkivSchemaDef): Schema {
  const cols: Record<string, unknown> = {}
  for (const [name, kind] of Object.entries(d.columns)) {
    const c = COLUMN[kind]() as { indexed?: () => unknown }
    cols[name] = d.indexed.includes(name) && kind !== "bytes" ? c.indexed!() : c
  }
  return defineSchema(d.name, cols as Columns)
}

export const ARKIV_SDK_SCHEMAS = Object.fromEntries(
  Object.entries(ARKIV_SCHEMAS).map(([k, d]) => [k, toSdk(d)]),
) as Record<ArkivSchemaName, Schema>
