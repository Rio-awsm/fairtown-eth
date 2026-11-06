# Arkiv queries Fairtown depends on

Network Rabdi (chain 7794095), SDK `@arkiv-network/sdk` 1.0.1. Schemas: `packages/shared/src/arkiv.ts` (`ARKIV_SCHEMAS`, `ARKIV_SDK_SCHEMAS`), namespace `fairtown.v1.`. Explorer: https://rabdi.explorer.arkiv.network

Values in predicates must carry the column type: `u256(...)`, `u64(...)`, `addr(...)` (see friction.md, issue 1).

```ts
import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, desc, eq, gte } from "@arkiv-network/sdk/query"
import { addr, u256, u64 } from "@arkiv-network/sdk/schema"
import { ARKIV_SDK_SCHEMAS as A } from "@fairtown/shared/arkiv"
import { http } from "viem"

const reader = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY! }), transport: http() })
const all = { $key: true, $owner: true, $expiresAt: true } as const
```

| Need | Query | Used by |
|---|---|---|
| Recent clears for a commodity at a market (floor, advice, price weather) | `reader.select({ ...all, avgPerUnit: true, day: true }).from(A.price).where(and(eq("commodity", "cod"), eq("place", "bergen"))).orderBy(desc("lotId")).limit(10).fetch()` | listing floor, seller advice, board |
| A seller's latest record | `reader.select({ ...all, tier: true, cleanLots: true, noShows: true }).from(A.reputation).where(eq("seller", addr(seller))).orderBy(desc("cleanLots")).limit(20).fetch()`, then take the newest by `day` | buyer guardrail, seller profile, lenders |
| Sellers with a no-show | `...from(A.reputation).where(gte("noShows", u64(1n)))` | buyer agents |
| Open lots in a market | `...from(A.lot).where(and(eq("market", "fish_dock"), eq("status", "open")))` | town, buyer console |
| Bids on a lot | `...from(A.bid).where(eq("lotId", u256(lotId)))` | lot panel |
| Live signals in a place | `...from(A.signal).where(eq("place", "bergen"))` | agents, town weather |
| Capacity for a chained lot | `...from(A.capacity).where(eq("lotId", u256(truckLotId)))` | freight yard |

## Owners and lifetimes (contract section 10)

| Schema | Owner | Expiry | Flags |
|---|---|---|---|
| lot | seller agent | auction end + 1 day | |
| bid | buyer agent (writer for walk-ins) | auction end + 1 hour | |
| price | writer | 180 days | readonly, permissionlessExtension |
| reputation | writer | 180 days | readonly, permissionlessExtension |
| capacity | truck or storage agent | ready-by + 1 day | |
| signal | writer | until the signal expires | |
| agent | agent wallet | 30 days | permissionlessExtension |

The 27 agent wallets exist (HD from `AGENT_MNEMONIC`) but hold no Rabdi gas yet, so the writer key `0x8BA90d413a1b48321De0D77CCF8C201A7086b2ef` owns every entity today (D-60). `pnpm -F agents arkiv:stats` runs these against Rabdi with only an access key.
