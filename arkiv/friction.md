# Arkiv friction log

Logged as it happened while building Fairtown at ETHGlobal Mumbai 2026. SDK `@arkiv-network/sdk` 1.0.1, network Rabdi (7794095), from a laptop in Mumbai. Each entry: what we expected, what happened, how to reproduce, what we did.

## The one fix that would help most

**An idempotent batch create.** One call that takes N entities, each with a client-chosen idempotency key, returns their keys, and skips any key that already exists. Our seed of a simulated market day wrote 186 entities in 1,206 s (about 6.5 s each, entry 5) because every write needs a dedupe query, a create and a receipt, one after another on one wallet's nonce queue. A batch with built-in dedupe would turn that into a few calls and remove the "did my write land?" query we run before every create and every retry.

## Time to first write and query

- 2026-11-06: SDK installed, schemas defined, first `createEntity` and read-back on Rabdi in one session. First live suite: 7 schemas written in 11.4 s (about 1.6 s per write including read-back).
- The error messages are good. Entries 1 and 3 were fixed in minutes because the message said exactly what to do.

## Issues

### 1. Filters on `u64` columns reject a bare bigint
- **Expected:** `where(eq("block", 12n))` on a `u64().indexed()` column matches.
- **Actual:** `InvalidPredicateError: "block" is a u64 column, but the predicate asserts a u256, so it could never match. Write u64(...) around the value.`
- **Reproduce:** a schema with `block: u64().indexed()`, then `select(...).from(S).where(eq("block", 12n)).fetch()`.
- **What we did:** wrap predicate values in the column's constructor (`u64(12n)`, `u256(x)`, `addr(a)`); our `ArkivStore.query` does it from the schema descriptor.
- **Suggestion:** when the query goes through a schema (`from(S)`), the SDK knows the column type and could coerce a bare bigint itself.

### 2. Arkiv is not in Context7
- **Expected:** the docs MCP most coding agents use (Context7) to have the SDK, like viem, Fastify, AI SDK or ws.
- **Actual:** no Arkiv entry. Checked again on 2026-11-06 during step S2 7.1: `resolve-library-id("Arkiv Network SDK")` returns Pi Network, Gains Network and others, no Arkiv.
- **What we did:** docs.arkiv.network and the official skills (github.com/Arkiv-Network/skills), which were accurate and saved real time (Rabdi gas policy, query limits).
- **Suggestion:** list the SDK in Context7; agent-driven teams look there first.

### 3. `limit` above 100 throws instead of capping
- **Actual:** `limit 101 exceeds the node maximum of 100. Page through the results with an offset instead.`
- **Context:** we asked for 101 rows to learn whether a next page exists.
- **What we did:** treat a full page of 100 as "maybe more" and fetch the next offset (`LiveArkivStore.query`).
- **Suggestion:** a `hasMore` flag (or a cursor) on the response.

### 4. Latency per write
- 1.5 to 7 s for create, receipt and read-back from Mumbai. The chain stays the truth for money, so a slow write never blocks a sale: the ledger writer runs behind the auction in its own queue.

### 5. Bulk writes are slow and need our own dedupe (measured)
- **Expected:** seeding about 190 entities to take a minute or two.
- **Actual:** 186 writes in 1,206 s, 0 retried, 0 failed (`pnpm -F agents arkiv:seed`, 2026-11-06). Each write is: query by owner and natural key (dedupe), create or patch with explicit gas (Rabdi policy: at least 1,000,000 per write, we send 1,500,000), wait for the receipt. One writer wallet means one nonce queue, so nothing runs in parallel.
- **Reproduce:** `pnpm -F agents arkiv:seed` with `ARKIV_ACCESS_KEY` and a funded `ARKIV_PRIVATE_KEY`.
- **What we did:** a queue per wallet, retries with backoff, and a dedupe query before every create and every retry (writes are idempotent by natural key, so a restart or retry never duplicates). Spreading writes over the 27 agent wallets would parallelise it, once they hold Rabdi gas.
- **Suggestion:** see "the one fix" above.

### 6. Watch events carry no attributes, and there is no event on expiry
- **Expected:** a stream the relay could turn into town events ("new price at Bergen").
- **Actual:** `watchEntityEvents` gives the entity key, owner and block, no attributes; an expired entity simply disappears.
- **What we did:** no Arkiv watcher. The relay takes live events from the chain; Arkiv is read on demand (advice, floors, board). Signals expire in Arkiv exactly when the chain says, which we wanted, but nothing tells a reader it happened.
- **Suggestion:** an option to include indexed attributes in watch events, and an `EntityExpired` event.

### 7. Short lifetimes have a 60 s floor in our store
- Not an Arkiv bug, but worth knowing: we clamp `ExpirationTime.fromSeconds` to at least 60 s. During the seed, the four demand signals (whose chain expiry had passed) were written with that minimum and were gone by the time we counted (signal: 0 live). Correct behaviour, surprising in a demo.
