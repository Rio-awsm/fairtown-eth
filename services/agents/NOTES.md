
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

## 2026-11-06, S2 5.1 LLM bidder

**Built:** `src/strategies/llm.ts` (persona prompt under 150 words from bio and kind, compact observation in display units, `BidAdvice` schema converted to a bigint `Decision` in code, 10-block cache, rule fallback, stats), `marketContext` (reference from `references.json`, last clears from Arkiv `price`, 30 s cache, survives Arkiv errors), `src/eval/bidderEval.ts` and `pnpm -F agents eval [n]` (report in `eval/report.{json,md}`, mock run in `eval/report-mock.*`). Runtime: strategies with `parallel: true` decide all agents on a lot at once, then bids execute in order; rules stay sequential. `index.ts` uses the LLM when `MOCK_AI=0`.

**Gotchas found live:**
- **The team LiteLLM key allows 60 requests/min across all roles.** The first live eval (200 decisions at once) "failed" with 40% invalid output: every one was an HTTP 429 that the gateway's JSON-retry loop swallowed, and its 2 retries made the overload worse. Fixes (D-66): `APICallError` maps to `rate_limited` (429) or `provider_error` and is never retried as bad JSON; optional `LLM_MAX_RPM` sliding window shared by all roles, bidder capped at 80% and falls back to rules at once, listing and vision wait. **Set `LLM_MAX_RPM=60` in `.env`.**
- LiteLLM's 429 body includes a hashed key id; gateway errors now carry the status code only.
- At 60 RPM a busy town can't ask the model for every agent every tick: hard passes skip the model, the cache absorbs repeats, and the rest fall back to rules. Expect a mix of LLM and rule reasons on a crowded lot.
- The guide's "cache for 2 blocks" assumed 2 s blocks; at 200 ms it is 10 blocks (D-64).
- First reasons leaned on "I'll bid the reference price" with no symbol; the prompt now asks for the symbol and one deciding fact.

## 2026-11-06, S2 5.2 sectors and handover behaviour

**Built:** `src/sectors/engine.ts` (event queue plus a block scheduler: relists, truck lots on `TransportNeeded`, cold-store lots on `StorageNeeded`, storage requests, scripted pickup and drop-off tickets, compute access, no-show reports, dispute flag), `src/sectors/rules.ts` (D-50 durations, relist floor, truck pick with backhaul, slot-days, family pool split), `src/sectors/compute.ts` (simulated GPU provider, labelled), `src/handover/tickets.ts` (only place seller keys sign), `src/handover/disputes.ts` (`POST /api/disputes`, fixture photos for the scene). Runtime gained lot-only duty mandates so a parent's buyer can bid on its truck or storage lot through the same guardrails. Wired in `index.ts`; fake mode uses the D-12 durations (blocks are 2 s there).

**Gotchas:**
- Guardrail rate limit (6 bids per agent per minute, D-61) is wall-clock. A buyer busy outbidding on its main lot can be blocked for up to a minute on its own truck or storage lot. Tests use a fake clock; in the demo, watch the Lagos cold-storage chain.
- Relist counting relies on the child lot's `parentLotId` pointing at the relisted lot (FakeChain does this). Check the real `MarketSettlement.relist` once S1 3.1 lands.
- On Base Sepolia v1, `openDispute` is `NotImplemented` (D-48 stubs); the route returns 409 `NotImplemented` until S1 4.1.
- No anvil (Foundry not installed). The guide's anvil chain test is covered by FakeChain scenarios now; a Base Sepolia run of cod, truck, pickup, drop-off needs S1 3.1 contracts.

## 2026-11-06, S2 5.3 signals, references, seller advice

**Built:** `src/market/state.ts` (live `DemandSignal`, `ReferencePriceUpdated`, `FxUpdated`; expiry by block; urgency; signal-driven `move` intents), `src/market/advice.ts` and `src/market/routes.ts` (`GET /api/sellers/:id/advice`, `GET /api/fx`), `src/data/fx.json`. Runtime observations now carry the live reference, signals and urgency (`marketFor`); the rule strategy scales its step by urgency, the LLM prompt lists live signals.

**Notes:**
- S1 4.2 and 4.3 are not deployed. Tests drive FakeChain's `pushSignal`, `pushReference`, `pushFx` stand-ins; the ABI on Base Sepolia v1 has no `DemandSignal` or `ReferencePriceUpdated`, so on the live chain the town runs on the snapshot until S1 v2.
- `ReferencePriceUpdated` round-trips: CRE W1 reads `/api/reference`, posts it, and the event upserts the same row. Idempotent, but the `source` becomes "CRE W1: <tag>".
- Severity scale is assumed 1 to 5; values above 5 are clamped. Confirm with S1 4.3.
