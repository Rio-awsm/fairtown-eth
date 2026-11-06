# Sponsor feedback (draft)

Draft by Stream 1 from `contracts/NOTES.md`, 2026-11-06. **Needs from the team:** each stream adds its own notes before this goes into the Uniswap form (https://developers.uniswap.org/hackathon-feedback) and to Chainlink. Everything below was seen in our code or tests; nothing is guessed. Exact CCA lines are in `contracts/README.md`.

## Uniswap: Continuous Clearing Auction (v2.1.0)

**What worked well.** One `create` call plus `onTokensReceived` gives a funded, live auction in a single transaction; the validation hook made "only registered agents bid" a 30-line contract; the event names match the source exactly; `requiredCurrencyRaised = 0` makes every auction graduate, which suits perishable goods.

1. **Docs vs source.** We coded against the v2.1.0 source, not the website, as a rule. Behaviour we only learned from the source:
   - `sweepCurrency` and `sweepUnsoldTokens` checkpoint the end block themselves (`ensureEndBlockIsCheckpointed`), so no extra `checkpoint()` is needed before exits.
   - `exitPartiallyFilledBid(id, lastFullyFilled, outbid)` hint rules: `lastFullyFilled.clearing < maxPrice`, `next(lastFullyFilled).clearing >= maxPrice`, `outbid = 0` only when the final clearing equals `maxPrice`. Hand-picked hints were wrong in our first test (a bid was outbid when a later bidder arrived, not when the next one did). A small view helper that returns the hints would remove a whole class of keeper bugs.
   - A second `claimTokens` doesn't revert (it transfers 0); a second exit does (`BidAlreadyExited`).
   - The hook gets `msg.sender` as `sender`, so routers can't bid for others: good, but worth stating in the docs.
   - **Team: add the specific doc pages that disagreed.**
2. **Per-block pricing surprised us.** Two bidders with the same max price and amount paid very different averages depending on when they bid: with a linear schedule an early bidder averaged €7.925/kg and a last-block bidder €10.05/kg (26.8% apart). We moved 75% of supply into the last block to get within 5% (4.5%). That is the design, but a sentence and a chart in the docs ("your average depends on the blocks you were live, not only your max") would save teams a day.
3. **Steps encoding.** `auctionStepsData` is packed `bytes8` steps (`uint24 mps` + `uint40 blockDelta`) that must sum to `1e7` mps and to `endBlock - startBlock` blocks; a zero `blockDelta` reverts. Easy once found in `StepLib.parse`, but there is no builder helper. A tiny library or a docs table with two worked examples would help.
4. **Permit2.** Bids pull currency through Permit2: an ERC-20 `approve` to Permit2 once, then a Permit2 allowance per auction. A missing allowance fails as `TransferFromFailed()` before the hook runs, which looks like a hook or balance problem at first. Permit2 pins `solidity 0.8.17`, so projects on newer compilers can't build it and must etch its bytecode in tests.
5. **No local Permit2.** A plain `anvil` (no fork) has no Permit2, so the first local auction fails. We commit Permit2's runtime bytecode (checked byte-identical to Base Sepolia) and `vm.etch`/`anvil_setCode` it. A note in the quickstart, or a Permit2 deploy script for local chains, would help.
6. **Factory.** We deployed our own `ContinuousClearingAuctionFactory` (zero fee controller) on Base Sepolia. The factory runtime is 24,214 bytes, 362 bytes under EIP-170, and only fits with CCA's own `via_ir` and 11111-runs profile. Projects that compile it with other settings get a size error. Published per-chain factory addresses for v2.1.0 (if they exist, we didn't find them in the docs) would let teams skip this.
7. **Rounding to know about.** `currencyRaised` rounds down by up to one base unit per bid (refunded on exit), and the floor is rounded down to a tick, so a bid of exactly `qty x floor` clears a few wei of tokens over `qty`. Harmless, but it changes "sold 180 kg" into "sold 180.00000000000001 kg".

**The one fix that would help most:** a view that returns `exitPartiallyFilledBid` hints for a bid id (or an `exit(bidId)` that finds them). Every integrator writes this walk, and getting it wrong locks funds until someone fixes the keeper.

## Chainlink: CRE (CLI v1.39.0, `@chainlink/cre-sdk` 1.23.0)

**What worked well.** `newTestRuntime` with `HttpActionsMock` and `EvmMock` let us test whole handlers without WASM; `ConsensusAggregationByFields` fits multi-value observations; `cre workflow limits export` made the write budget explicit; the simulator's `--broadcast` against the mock forwarder gave real on-chain results.

1. **The simulator reports success for reverted receivers.** The forwarder swallows a receiver revert (`ReportProcessed(..., false)`), the transaction succeeds, and the SDK reads a missing receiver status as `SUCCESS`. Our first broadcast printed "written" for ten reports and stored nothing. We now verify every write from receipts. Please surface the receiver result in the reply (or fail the write).
2. **`scheduledExecutionTime` in simulation is the next slot**, up to an hour ahead, and the simulator's log timestamps are local time with a `Z` suffix. Reports stamped with it were rejected as "from the future" by our stale guard. We use `runtime.now()`.
3. **Unreachable HTTP throws.** A connection error makes `sendRequest(...).result()` throw and ends the whole execution, unlike an HTTP error status. One dead source stopped a run of five; we catch it per source now.
4. **WASM build limits found by trial:** the entry file can't export functions with parameters (Javy: "Exported functions with parameters are not supported"); zod's `.url()` fails inside WASM (no `URL`); `--config` paths over 97 characters are rejected and relative paths resolve from the workflow folder.
5. **Online login check on every simulation.** Each `cre workflow simulate` validates the login at `api.cre.chain.link`; a TLS timeout there failed a run. For demos that run the simulator on timers this is a hidden network dependency.
6. **Install on shared networks.** The install script needs one anonymous GitHub API call; on a network that used its 60 calls an hour it fails with 403. A fallback to the release redirect URL would avoid that.
7. **Docs sources.** The forwarder table we got through a docs aggregator had placeholder-looking addresses; `cre workflow supported-chains` was right. Pointing to the CLI command first would help.

**The one fix that would help most:** make a reverted receiver visible in the `writeReport` reply and the simulator output. Everything else cost us minutes; that one could ship a demo that silently writes nothing.

## Others

**Team: Arkiv, 0G, ENS, World, Hedera and others from Streams 2 and 3.**
