# Fairtown

An open market for anything with an expiry date. AI agents and people bid in onchain auctions, sellers are paid in stages, and a live pixel town shows every bid. Built at ETHGlobal Mumbai 2026.

**Status:** work in progress. All money in this project is test money on testnets.

## Setup

Needs Node 22.10+ and pnpm 9 (the repo pins 9.15.9; pnpm 9.7+ switches to it automatically).

```bash
pnpm i
cp .env.example .env
pnpm run doctor
pnpm test
```

Use `pnpm run doctor`, not `pnpm doctor`: the second runs pnpm's own built-in check instead of ours.

## Arkiv

Fairtown keeps the public record of its market on Arkiv (network Rabdi, chain 7794095): every lot, bid, cleared price, seller record, truck or storage slot, demand signal and agent. Seller floors, seller advice and the bidding agents read it back. Details: [`arkiv/schema.md`](arkiv/schema.md), [`arkiv/how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md), [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md), [`arkiv/reach.md`](arkiv/reach.md), [`arkiv/friction.md`](arkiv/friction.md), [`arkiv/queries.md`](arkiv/queries.md).

**Writer wallet:** `0x8BA90d413a1b48321De0D77CCF8C201A7086b2ef` owns every Fairtown entity today (the 27 agent wallets take over their own lots and bids once funded on Rabdi; see schema.md). Explorer: https://rabdi.explorer.arkiv.network

**Run one query.** Get a free access key at https://hub.arkiv.network/access-keys, put it in `.env` as `ARKIV_ACCESS_KEY` (no private key needed), then:

```bash
pnpm -F agents arkiv:stats
```

It counts every `fairtown.v1.*` entity by schema and owner, then runs the query behind seller advice and listing floors: the last 10 cod prices at Bergen. Or, without this repo:

```ts
import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, desc, eq } from "@arkiv-network/sdk/query"
import { defineSchema, str, u256 } from "@arkiv-network/sdk/schema"
import { http } from "viem"

const price = defineSchema("fairtown.v1.price", {
  commodity: str().indexed(), place: str().indexed(), currency: str().indexed(), lotId: u256().indexed(),
  finalClearingPerUnit: u256().indexed(), avgPerUnit: u256().indexed(), soldUnits: u256().indexed(), day: str().indexed(),
})
const reader = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY! }), transport: http() })
const rows = await reader
  .select({ $key: true, $owner: true, lotId: true, finalClearingPerUnit: true, soldUnits: true, currency: true, day: true })
  .from(price).where(and(eq("commodity", "cod"), eq("place", "bergen"))).orderBy(desc("lotId")).limit(10).fetch()
console.log(rows.entities) // typed values, e.g. finalClearingPerUnit { type: "u256", value: "9000000" } = €9.00 per kg (6 decimals)
```

The entities on Rabdi as of 2026-11-06 come from a simulated market day (`pnpm -F agents arkiv:seed`), and each lot says so in `details.simulated`; lots sold on Base Sepolia in the demo are written by the same ledger writer.

## Licence

MIT. See `LICENSE`.
