# Why Arkiv

Fairtown is a market for goods that expire: a boat's morning cod, a truck's empty return run, a GPU's idle night. AI agents bid in a Uniswap continuous clearing auction on Base Sepolia, sellers are paid in stages, and a missed handover refunds the buyer. Arkiv holds the **public record** of that market: what sold, for how much, and how each seller behaved.

## What users would lose on Postgres

1. **Prices nobody can edit.** A `price` entity is written once per settled lot with the `readonly` flag: nobody, including our writer, can patch it afterwards. (The owner can still delete it, but a deletion is a visible missing record with its own transaction, not a silent rewrite; and copies already read stay valid against the chain's `LotSettled` event.) On Postgres, whoever runs the database can quietly rewrite yesterday's cod price, which is exactly what a powerful middleman would want. A small seller (Ingrid in Bergen, Amina at Mile 12) can check the last clears for their commodity at their market without trusting us: `pnpm -F agents arkiv:stats`, or the query in the README.
2. **A seller record that outlives us.** `reputation` (clean lots, no-shows, tier) is also `readonly`, and `permissionlessExtension` means anyone (a cooperative, a lender, a rival marketplace) can pay to keep it alive past its 180 days. On Postgres the record dies with our server, and a seller who built a clean history here starts from zero elsewhere.
3. **Listings that clean themselves up.** Bids expire an hour after their auction, lots a day after, capacity a day after its ready-by block. Nobody runs a cron job, and nobody can keep a stale truck slot on the board to look busy.
4. **Other agents can read the market.** Any agent, not only ours, can query open lots by market and recent clears by commodity, with the same indexed filters we use. On Postgres they would need our API, our rate limits and our permission.

## What we kept off Arkiv, and why

| Kept off | Where it lives | Why |
|---|---|---|
| Money: payouts, held shares, refunds | Base Sepolia contracts (CCA plus `MarketSettlement`) | Money needs the chain's guarantees and atomic settlement; Arkiv is the public record of it, never the source of truth |
| Photos | Agents service disk; only SHA-256 hashes go in `lot.details` | Too large (Arkiv payloads are capped at 100 KiB) and personal; the hash still proves which photo was graded |
| Handover codes (signed EIP-712 tickets) | Shown as a QR, verified by the contract | A ticket is a bearer secret until used |
| Session tokens, PINs, keys | Agents service memory and `.env` | Secrets |
| Seller chat and voice | Not stored | Private, and not needed for the record |
| Live town animation | Our relay (WebSocket) | Arkiv watch events carry no attributes (friction.md, entry 6). If our relay dies, the board and the ledger keep working from Arkiv; only the walking sprites stop |

## What it costs us (honest)

Writes are slow (about 6.5 s each in bulk, friction.md entry 5), so the ledger runs behind the auction and nothing waits on it. Today one writer key owns every entity (schema.md); the decentralised version, each agent writing its own lots and bids, needs its wallet funded on Rabdi, which is one command (`pnpm -F agents fund:arkiv`).
