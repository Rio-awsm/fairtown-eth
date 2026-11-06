# How we use Arkiv

Each Arkiv feature below is tied to something a user sees. Entity definitions: [`schema.md`](schema.md). Queries: [`queries.md`](queries.md).

## Reads that users see

| Feature | What the user sees | Arkiv read | Code |
|---|---|---|---|
| Suggested floor when a seller lists | "Reference 8.30 and median of last 4 clears 9.10, averaged" in the floor basis on `/sell` | `price` where commodity, place; order by lotId desc; limit 10 | `services/agents/src/index.ts` (`recentPrices`), `src/listing/floor.ts` |
| Seller advice | "cod at bergen cleared a median €9.10 over the last 3 lots, above the €8.30 reference ... You're new: 50% at sale" with every number in `basis` | `price` (same query, plus currency) and `reputation` where seller | `GET /api/sellers/:id/advice`, `src/market/advice.ts` |
| Agent reasoning | The bidder LLM's observation lists "recent clears 9.1, 8.7", which shows up in its 80-character speech bubble | `price` where commodity, place, currency; cached 30 s | `src/strategies/llm.ts` (`marketContext`) |
| Public board and town (S3) | Price weather, seller records, open lots per market | queries in `queries.md` | S3, planned |

If Arkiv is down, each read degrades rather than failing: the floor falls back to the reference, advice uses the chain's seller record and says so in `basis.arkiv`, and the bidder decides without recent clears (tested in `test/market.test.ts` and `test/strategy.llm.test.ts`).

## Filtered fields fit the questions people ask

- "What did cod fetch at Bergen lately?" → `price` indexed on commodity, place, currency, lotId (ordering), day.
- "Is this seller reliable?" → `reputation` indexed on seller, noShows (`gte(noShows, 1)` finds sellers with a no-show), tier, day.
- "What is open at the fish dock?" → `lot` indexed on market and status.
- "Which truck slot belongs to my lot?" → `capacity` indexed on lotId, kind, toPlace.
Unindexed columns (`details`, `reason`, `tx`, `label`, `notes`, `mandate`) are payload only; our `ArkivStore` refuses to filter on them (`NotIndexed`), the same rule as the SDK.

## Edit permissions match who may change what

| Entity | Who can patch | Why |
|---|---|---|
| `price`, `reputation` | nobody (`readonly`) | The record must not change after the fact. A new `SellerRecordUpdated` writes a new `reputation` entity; readers take the latest by `day` |
| `lot` | its owner: the seller agent by design, the writer today (schema.md, "Owners today") | `status` moves as the chain moves: open, sold, truck_booked, picked_up, delivered, paid_in_full, or no_show_reported, refunded. The seed run made 55 such patches on 12 lots |
| `bid`, `capacity`, `signal` | owner only, and we never patch them | Each is a statement at a moment; a new bid is a new entity |
| `agent` | owner | Written at bootstrap. Mandate edits (`PATCH /api/agents/:id`) change the running agent only and are not yet patched into Arkiv |

`permissionlessExtension` on `price`, `reputation` and `agent` means anyone can keep those alive past our 180 or 30 days without asking us.

## Expiry matches how long things matter

| Entity | Lifetime | Visible effect |
|---|---|---|
| `bid` | auction end + 1 hour | the lot panel shows a lot's bids during and just after the auction, then they clear |
| `lot` | auction end + 1 day | yesterday's lots leave the board without a cleanup job |
| `capacity` | ready-by + 1 day | a truck slot can't linger as fake availability |
| `signal` | until the signal's `expiresAtBlock` | the storm disappears from the board when it does on chain (all 4 seed signals had expired when counted) |
| `price`, `reputation` | 180 days | the price history and seller record behind floors and advice |
| `agent` | 30 days, extendable | the roster of who traded |

## Writes, numbers and idempotency

The ledger writer (`src/arkiv/ledgerWriter.ts`) turns each chain event into at most one create or patch, behind the auction, so a slow write never delays a sale. Every create first queries by owner and a natural key on indexed columns (lot: lotId; bid: lotId, agent, block, price; price: lotId; reputation: seller, counts, day; signal: kind, place, expiry), so a retry or a restart that replays chain history never duplicates an entity (`test/hardening.test.ts`, "replaying a whole day"). Failed writes are retried twice with backoff, then counted in `/api/health` (`ledger`).

**Seed run, 2026-11-06** (`pnpm -F agents arkiv:seed`): the `full_day` scenario (seven scenes: Bergen cod with a chained truck, the Dallas return run, GPU night, Diwali marigolds, the rose flight, Lagos tomatoes with cold storage, the Coastal Catch no-show) played on our FakeChain and mirrored through the same ledger writer. 186 writes in 1,206 s: agent 27, lot 67 (12 creates, 55 status patches), bid 65, price 12, reputation 15, capacity 6, signal 4; 0 retried, 0 failed. Every lot entity carries `details.simulated: "full_day scenario on FakeChain (S2 7.1 seed), not a real sale"`, so nobody mistakes it for a real sale. Lots sold on Base Sepolia during the demo are written by the same code with no such flag.
