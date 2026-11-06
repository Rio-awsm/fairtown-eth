# Arkiv schema

Network **Rabdi** (chain 7794095), SDK `@arkiv-network/sdk` 1.0.1, namespace `fairtown.v1.`. Source of truth for the definitions: [`packages/shared/src/arkiv.ts`](../packages/shared/src/arkiv.ts) (`ARKIV_SCHEMAS`, `ARKIV_SDK_SCHEMAS`). Writer: [`services/agents/src/arkiv/ledgerWriter.ts`](../services/agents/src/arkiv/ledgerWriter.ts), which mirrors Base Sepolia contract events into these entities. Money columns are `u256` base units (6 decimals), blocks `u64`, addresses `addr`.

| Entity | Written when (chain event) | Columns (indexed in bold) | Owner | Expiry | Flags | Read by |
|---|---|---|---|---|---|---|
| `lot` | `LotListed`; `status` patched on `LotSettled`, `CarrierAssigned`, `HandoverConfirmed`, `LotDelivered`, `LotPaidInFull`, `NoShowReported`, `NoShowRefunded`, `DisputeOpened`, `RulingSettled`, `LotRelisted` | **sector, commodity, grade, market, place, currency, status, lotId, auction, floorPerUnit, endBlock, parentLotId**, details (bytes JSON: photo hashes, grade report, 0G request id) | seller agent | auction end + 1 day | none (the seller patches `status`) | town and buyer console, open lots by market (S3, planned) |
| `bid` | `BidSubmitted` | **lotId, agent, maxPerUnit, amount, block**, reason | buyer agent; the writer for walk-ins | auction end + 1 hour | none | lot panel (S3, planned) |
| `price` | `LotSettled` with units sold, once per lot | **sector, commodity, grade, market, place, currency, lotId, finalClearingPerUnit, avgPerUnit, soldUnits, day**, tx | writer | 180 days | `readonly`, `permissionlessExtension` | listing floor (`POST /api/listings/draft`), seller advice, bidder LLM context |
| `reputation` | every `SellerRecordUpdated` | **seller, tier, cleanLots, noShows, day**, lastLotId, tx | writer | 180 days | `readonly`, `permissionlessExtension` | seller advice (`GET /api/sellers/:id/advice`) |
| `capacity` | `LotListed` for a truck or storage lot | **kind, fromMarket, toPlace, qty, readyByBlock, lotId**, notes ("for lot N") | truck or cold-store agent | ready-by + 1 day | none | freight yard (S3, planned) |
| `signal` | `DemandSignal` (CRE W2) | **kind, place, severity, expiresAtBlock**, label | writer | until the signal expires | none | town weather (S3, planned); agents read signals from the chain event |
| `agent` | agent bootstrap | **role, name, building**, mandate (bytes JSON) | agent wallet | 30 days | `permissionlessExtension` | town roster (S3, planned) |

## Queried fields

Only indexed columns are filtered or ordered (the SDK refuses anything else, and so does our `ArkivStore`, with `NotIndexed`). The queries the product runs are in [`queries.md`](queries.md); the main one:

```ts
reader.select({ $key: true, finalClearingPerUnit: true, avgPerUnit: true, soldUnits: true, day: true })
  .from(ARKIV_SDK_SCHEMAS.price)
  .where(and(eq("commodity", "cod"), eq("place", "bergen"), eq("currency", "EUR")))
  .orderBy(desc("lotId")).limit(10).fetch()
```

## Owners today (honest)

Every live entity is currently owned by the writer `0x8BA90d413a1b48321De0D77CCF8C201A7086b2ef` (decision D-81). The 27 agent wallets exist (HD from `AGENT_MNEMONIC`) but are not funded with Rabdi gas yet; `pnpm -F agents fund:arkiv` funds them, after which `lot`, `bid`, `capacity` and `agent` entities are created by the agent that owns them, as the table says. `price`, `reputation` and `signal` stay with the writer by design: they are the public record, not any one agent's claim.

## Live counts

`pnpm -F agents arkiv:stats` (needs only `ARKIV_ACCESS_KEY`). On 2026-11-06 after the seed run described in [`how-you-use-arkiv.md`](how-you-use-arkiv.md): lot 12, bid 65, price 12, reputation 15, capacity 6, agent 27, signal 0 (all four had expired, as designed). Bids drop out one hour after their auction ends; prices and seller records stay 180 days.
