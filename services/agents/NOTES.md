
## 2026-11-06, S2 3.1 backlog: ViemChain on Base Sepolia

**Pulled from stream-1 without merging:** `deployments/*.json`, `packages/shared/src/abi/generated.ts`, price vectors and `.env.example` (ICR-003 windows x10). Records reconciled: S2 decisions renumbered D-54 to D-61, S2 ICRs to ICR-004 and ICR-005.

**ViemChain** (`src/chain/viem/ViemChain.ts`) implements `ChainAdapter` against the deployed contracts, using the call sequence from S1's smoke script: ERC-20 approve of Permit2 once per token, Permit2 allowance per auction, `submitBid(maxPriceQ96, amount, owner, "0x")`, events by HTTP log polling over every deployed contract plus each seen auction (no WebSocket needed).

**Live result.** `pnpm -F agents test:live` (viemchain): Ingrid listed 100 kg cod (lot 10) for 300 blocks, Hanse and Fjord bid by rules through guardrails (3 bids landed), the lot settled `sold`, and the poller saw LotListed, BidSubmitted, ClearingPriceUpdated, CheckpointUpdated, LotSettled and TransportNeeded. Anvil is not installed here, so Base Sepolia stands in for the guide's anvil test.

**Gotchas found live (all fixed):**
- Fee estimate from the public RPC came in below the moving base fee: writes now use 2x the estimated `maxFeePerGas`.
- The public RPC (`sepolia.base.org`) rate-limits and load-balances: reads can lag a just-mined approval, and `eth_estimateGas` flaps. Fixes: retries with backoff, explicit gas on approves (120k) and bids (1.5M), approvals remembered once mined, one retry on transient errors.
- **CCA `clearingPrice()` is the last checkpoint, not the live price.** Supply releases block by block, so a bid computed from it can hit `BidMustBeAboveClearingPrice`. Bids are now simulated first (no gas spent on a doomed bid) and that case counts as "outbid", not a failure. Clearing is converted from Q96 rounding up.
- Unfunded agents in the runtime will try to bid; production bootstraps all 27 first.

**Still open.** `RPC_WS_URL` (Alchemy) returns HTTP 401: the key in `.env` is 27 characters and looks truncated. `RPC_URL` is still the public endpoint. Operator wallet has 0.0144 ETH; 27 agents at 0.0005 ETH each need 0.0135, so top it up before running the full town on Base Sepolia.

## 2026-11-06, S2 4.1 relay

**Built:** `services/relay/src/mapping.ts` (every section 7 event to its TownEvent, deterministic ids `chain-<tx>-<logIndex>` so backfills and reconnects dedupe), `chainWatcher.ts` (new heads over the Alchemy WebSocket with reconnect, logs over HTTP from the last processed block, newly listed auctions picked up mid-range, clearing-price ticker every 2 s, clock every 25 blocks), `/internal/chain` dev bridge for `CHAIN_MODE=fake` (agents forward FakeChain logs, the relay maps them, so only the relay produces chain-derived events).

**RPC limits found live:**
- Alchemy free tier rejects `eth_getLogs` over about 10 blocks, with a misleading "JSON is not a valid request object" (HTTP 400).
- The public Base Sepolia RPC caps `eth_getLogs` at 200 blocks ("eth_getLogs is limited to a 200 range").
- Fix: logs go to `LOGS_RPC_URL` (default public RPC) in 200-block chunks; heads, reads and writes stay on Alchemy. Backfilling 20,000 blocks takes about 45 s.
- viem error messages include the RPC URL and therefore the Alchemy key. All relay and agents logging strips URLs; a live test printed one raw error once before the fix (testnet key; rotate if wanted).

**Live result.** `pnpm -F relay test:live`: backfill from the v1 deployment block to a real WebSocket client, 82 envelopes, no errors; S1's smoke lot 1 reached `paid_in_full` through handover and delivered, lots 2 to 10 `sold`.

**Not built:** an Arkiv watcher. Arkiv watch events carry no attributes and the TownEvent union has no Arkiv entity event; S3 reads prices and reputation from Arkiv directly with `arkiv/queries.md`.
