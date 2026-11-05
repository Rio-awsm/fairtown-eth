# Arkiv friction log

Logged as it happened while building Fairtown (ETHGlobal Mumbai 2026). SDK `@arkiv-network/sdk` 1.0.1, network Rabdi (7794095).

## Time to first write and query

- 2026-11-06: SDK installed, schemas defined and first `createEntity` plus read-back on Rabdi in one session. First live suite run: 7 schemas written in 11.4 s (about 1.6 s per write including read-back).

## Issues

### 1. Filters on `u64` columns reject a bare bigint
- **Expected:** `where(eq("block", 12n))` on a `u64().indexed()` column matches.
- **Actual:** `InvalidPredicateError: "block" is a u64 column, but the predicate asserts a u256, so it could never match. Write u64(...) around the value.`
- **Reproduce:** schema with `block: u64().indexed()`, then `select(...).from(S).where(eq("block", 12n)).fetch()`.
- **Workaround:** wrap predicate values in the column's constructor (`u64(12n)`, `u256(x)`, `addr(a)`). The error message is clear and says exactly this, which saved time.
- **Suggestion:** when querying through a schema (`from(S)`), the SDK already knows the column type and could coerce a bare bigint itself.

### 2. Arkiv is not in Context7
- The docs MCP most coding agents use has no Arkiv entry. We used docs.arkiv.network and the official skills repo (github.com/Arkiv-Network/skills), which were good. Listing the SDK in Context7 would help agent-driven teams.

### 3. `limit` above 100 throws instead of capping
- **Actual:** `limit 101 exceeds the node maximum of 100. Page through the results with an offset instead.`
- **Context:** we asked for 101 rows to detect whether a next page exists. Fine once known, and the message is clear; a `hasMore` flag on the response would remove the trick entirely.

### 4. Latency
- A create plus receipt plus read-back takes about 1.5 to 7 s on Rabdi from Mumbai. Our ledger writer queues writes per wallet so nonces stay ordered, and the chain stays the source of truth for money, so a slow write never blocks a sale.
