# Stream 1 notes

Gotchas, doc vs source mismatches and open questions. These feed `FEEDBACK.md`.

## 2026-11-06, S1 0.1

**`forge init --no-git` no longer means "don't create a repo".**
- Guide: `forge init --no-git contracts`.
- Foundry 1.9.0: `--no-git` means "install dependencies without adding them as submodules" (vendored copies).
- Used: `forge init --use-parent-git --empty --offline contracts`. No nested repo, no Counter example, no commit (forge only commits with `--commit`).

**`forge install` of CCA v2.1.0 fails, then silently rolls back.**
- `lib/liquidity-launcher/.gitmodules` (inside CCA) declares OpenZeppelin as `git@github.com:OpenZeppelin/openzeppelin-contracts.git`. Machines without a GitHub SSH key fail that clone ("Host key verification failed").
- `forge install` then deletes the submodule, `.gitmodules` and `.git/modules`, so it looks as if nothing happened.
- Workaround, used here and needed by anyone cloning the repo:
  ```sh
  git submodule update --init contracts/lib/continuous-clearing-auction
  git -C contracts/lib/continuous-clearing-auction -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init --recursive
  ```
  The `-c` rewrite applies to that one command only. It doesn't change global git config.
- Also: `git submodule add` records the default branch's HEAD. After `git checkout v2.1.0` in the submodule, the pointer must be re-staged (`git add contracts/lib/continuous-clearing-auction`), or the commit pins `main`.

**Dependencies come from CCA's own pins (D-37).**
- Guide: separate Permit2, OpenZeppelin and forge-std submodules.
- Chosen: one copy of each, remapped to CCA v2.1.0's `lib/`:
  - OpenZeppelin `e4f7021` (package.json 5.3.0)
  - Permit2 `cc56ad0` (canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` code)
  - forge-std v1.9.7, solady `2af0640` (v0.1.23), blocknumberish v1.1.0, liquidity-launcher v3.0.0, v4-periphery `60cd938`
- `auto_detect_remappings = false`. Auto-detection pulls about 60 nested remappings (optimism, kontrol, three more OZ copies). `remappings.txt` is explicit. One scoped entry: liquidity-launcher's `ProtocolFeeLib` imports `@uniswap/v4-core/`.

**CCA compile profile (D-36).**
- CCA's `foundry.toml`: `optimizer_runs = 11111`, plus a `via_ir` profile restricted to `src/ContinuousClearingAuctionFactory.sol`. Guide: optimizer 200.
- Chosen: our default 200, CCA's `via_ir` profile and restriction copied with 11111, path rewritten to `lib/continuous-clearing-auction/src/...`.
- Restrictions also apply to files that import the restricted file. Tests deploy the factory with `vm.deployCode(...)` and talk to it through `IContinuousClearingAuctionFactory`, so test files stay on the fast pipeline. `test/utils/CcaArtifacts.sol` is import-only, so forge builds the factory artifact at all. Without it nothing imports the factory and `vm.deployCode` has no artifact.
- CCA sets `ffi = true` for its own tests. We keep `ffi = false`.

**Sizes (forge 1.9.0, `forge build --sizes`).** `ContinuousClearingAuction` runtime 18,061 B, initcode 21,894 B. `ContinuousClearingAuctionFactory` runtime **24,214 B, 362 B under EIP-170**, because it embeds the auction's creation code. This is fixed by CCA's own profile, which we copied (D-36). Never compile the factory with fewer runs or other settings without rechecking the size. `LotFactory` must call the deployed factory, never embed it.

**No Permit2 on a plain local EVM.** `test_plainEvmHasNoPermit2` pins this. Integration tests must fork Base Sepolia or `vm.etch` Permit2. Permit2 is live on Base Sepolia with the expected EIP-712 domain (`ForkSmoke`).

**forge only reads the repo-root `.env` from the repo root.**
- `forge test --root contracts` (what `pnpm test:contracts` runs) loads `../.env`. `cd contracts && forge test` doesn't, so `ForkSmoke` skips with "RPC_URL unset".
- Checked with a throwaway project on 2026-11-06.

**Anvil prints the fork URL in its banner.** That URL can contain an RPC API key. `pnpm chain:fork` (`scripts/chain-fork.ts`) redacts it line by line.

## 2026-11-06, S1 1.1

**The hook can't be bypassed: CCA passes `msg.sender` as `sender`.** `ContinuousClearingAuction.sol` `_submitBid` calls `VALIDATION_HOOK.handleValidate(_maxPriceQ96, _amount, _owner, msg.sender, _hookData)`. The hook reverts unless `sender == owner && canBid(owner)`, so a router bidding for someone else is rejected (`HookOnCca.t.sol`). CCA wraps the hook's revert as `ValidationHookCallFailed(bytes reason)`. ERC-165 id of `IValidationHook` is `0x22c44b5f`, matching contract 7.3.

**Hook runs before the currency check matters.** The `submitBid` order is: amount and owner checks, currency pull (native `msg.value` or Permit2), then `_submitBid`, which calls the hook. The 1.1 integration test uses native ETH so it needs no Permit2 setup. Permit2 bids come in 1.2.

**Step data rules (`StepStorage._validate`).** `sum(mps * blockDelta) == 1e7` and `sum(blockDelta) == endBlock - startBlock`. A zero `blockDelta` reverts. A zero `mps` is allowed, so `endWeighted(d, 10000)` is valid. `endWeighted(45, 5000)` = `(113636 mps x 44 blocks) + (5000016 mps x 1 block)`.

**forge MemoryOOG on long sweeps.** Calling a harness that returns `bytes` about 45,000 times in one test grows memory until it runs out. Decode inside the harness and return only numbers.

**forge-lint.** `vm.getBlockTimestamp()` is used in tests after `vm.warp` (`environment-read-across-mutation`). `require-revert-in-loop` is excluded in `foundry.toml`: our libraries revert on bad input by design, and the tests call them in loops.

**Price vectors.** `forge test` rewrites `packages/shared/fixtures/price-vectors.json` (ICR-001). The file is deterministic, so a rerun shows no diff unless `PriceMath` changes. Prettier ignores it.

## 2026-11-06, S1 1.2

**Price spread (the guide's target is within 5%).** In `test_spreadTable`, an early bidder (first block) and a late bidder (last block) bid the same max (€10.00, ticked to €10.05) and the same amount, with a crowd's demand rising across 600 kg of cod at €7.50 over 45 blocks:

| Last-block share | Avg early €/kg | Avg late €/kg | Spread |
| --- | --- | --- | --- |
| 0 | 7.925 | 10.050 | 26.8% |
| 2500 | 8.272 | 10.050 | 21.5% |
| 5000 | 8.602 | 9.525 | 10.7% |
| 7500 | 8.687 | 9.075 | 4.5% |
| 9000 | 8.916 | 9.075 | 1.8% |

The default moved to 7500 (D-40, ICR-002). This is one scenario; the spread depends on how demand arrives. Mentor question: sniping risk at 75% in the last block.

**Fills are per block (contract 8.1, confirmed).** Each bid's tokens come from `cumulativeMpsPerPrice` over the blocks it was live, so the same max price yields different averages. A late bid only sees the last steps' supply, at the higher clearing price.

**Exit hints.** Walk the checkpoint list back from `lastCheckpointedBlock()` through `prev`: `outbidBlock` is the earliest checkpoint whose clearing price is above `maxPrice` (0 if the final clearing price equals `maxPrice`), and `lastFullyFilledCheckpointBlock` is the latest checkpoint below `maxPrice`. **Checkpoint the end block first** (`checkpoint()` or a sweep): before that, `lastCheckpointedBlock` is stale and the hints are wrong (`CannotExitBid`). `exitBid` is only for `maxPrice > finalClearing`. `claimTokens` needs the bid exited and `block >= claimBlock`.

**Order inside `submitBid`.** Permit2 pull (`SafeTransferLib.permit2TransferFrom`, which reverts `TransferFromFailed()` = `0x7939f424`), then `_submitBid` (hook, sold-out check, above-clearing check). A missing Permit2 allowance fails before the hook runs.

**Local Permit2.** Permit2 pins `pragma solidity 0.8.17`, so it can't compile with our 0.8.26. Tests `vm.etch` the runtime code from `test/fixtures/permit2.runtime.hex`, fetched with `cast code` from Base Sepolia over the public RPC. `test_fork_permit2FixtureIsCanonical` proves it's byte-identical. Permit2 recomputes its EIP-712 domain separator on other chain IDs, so the etched copy works on chain 31337.

**`vm.prank` gotcha.** `vm.prank(x); a.submitBid(_priceQ96(a, p), ...)`: the external view call inside the argument list (`a.tickSpacing()`) uses up the prank, so `submitBid` comes from the test contract. Compute arguments before `vm.prank`.

**Gas.** `createLot` costs about 4.89M (it deploys the ~20 KB auction and the LotToken), 12,572 B runtime. CCA's own snapshots: `submitBid` 154k to 361k, `checkpoint` about 170k, `exitBid` about 84k, `claimTokens` about 67k. A full 3-buyer auction: €5,320.58 raised, final clearing €9.075/kg, outbid buyer refunded €4,679.42, token dust 3 wei.

**CCA event names (contract 7.9) match v2.1.0 source exactly:** `BidSubmitted`, `CheckpointUpdated`, `ClearingPriceUpdated`, `BidExited`, `TokensClaimed`, `TokensReceived` (`IContinuousClearingAuction.sol` lines 96 to 127).

**Lot status.** `Lot.status` stays 0 (OPEN) in 1.2. Contract 7.4 has no function for settlement to update it. Decide in 1.3: read status from settlement views (contract 7.4 says "detailed status lives in settlement views"), or add a minor ICR.

## 2026-11-06, S1 1.3

**Wiring (D-41) in tests.** `SettlementFixture` predicts settlement with `vm.computeCreateAddress(this, nonce + 2)` before deploying LotFactory (+0) and ChainTrigger (+1), then asserts the deployed address. The 1.4 deploy script must keep that order.

**Exact numbers from real CCA auctions.** One bid of €5,460 on 1,000 kg at €7.50 (capacity €7,500) fills fully at the floor, so `currencyRaised` is exactly 5,460.000000. Settle gives 54.60 fee, 2,702.70 advance and 2,702.70 held (guide example, exact). Proven: €1,000 gives 891.00 now and 99.00 held (SoT 8.4). Truck: €50 gives 44.55 held.

**Ticket identity.** Same lot, buyer, amount and expiry produce the same digest, so a second identical ticket is a replay and is rejected. **S2:** when signing repeated equal partial pickups, vary `expiryBlock`.

**`soldTokens` vs claims.** `soldTokens = auction.totalCleared()`. Buyers' claimed tokens can be a few wei less (CCA rounds down). Handover shares are pro-rata on outstanding tokens, and below `TOKEN_DUST` (1e12 wei) a lot counts as handed over, with the remaining money going to the seller (D-46).

**Reentrancy lints.** `reentrancy-no-eth` and `reentrancy-events` are scoped off for `MarketSettlement` only (`disable-start/end`). The lint counts OZ ReentrancyGuard's own `_status` reset and SignatureChecker's ERC-1271 staticcall. Every external entry point is `nonReentrant` and checks-effects-interactions ordered: `_maybeComplete` returns dust instead of transferring it, so transfers come last. Calls that must come first (CCA sweeps, resolver dispute id, LotFactory relist id) are commented in place. **Recheck on any change.**

**Contest needs a resolver.** v1 (S1 1.4) deploys with `resolver = address(0)`: `contestNoShow` reverts `NoResolver`, and the uncontested path (finalize after the contest window) still ends in a money outcome. Tests use `MockResolver`.

**Relisting fractions.** `relist` burns all unsold tokens and relists `floor(unsold / 1e18)` whole units, so a fractional remainder isn't relisted. A relisted truck lot's `parentLotId` points at the old truck lot, not the goods lot, which matters for chaining in S1 3.1.

**NatSpec gotcha.** `/// ... @fairtown/shared/...` in a function doc is parsed as a NatSpec tag and fails the build. Use `//`.

## 2026-11-06, S1 1.4

**Base now makes ~5 blocks per second, not one per ~2 s.** Measured 54 blocks in 10 s on Base Sepolia and 52 on Base mainnet; several blocks share a timestamp. The guide's Phase 0 fact ("about 2s blocks") and SoT 14 are out of date. Every block value ran 10x faster than intended (a 45-block auction was 9 s, the contest window 12 s), so all windows are scaled x10 (D-50, ICR-003). Spread results in blocks (1.2) still hold. **For the keeper (2.1):** D-15 "checkpoint every 2 blocks" is now every 0.4 s; revisit the cadence. **Feedback candidate** for Base and the guide.

**Deployed v1 on Base Sepolia** at block 54998548, commit `1fdaa59`, all 10 verified on Basescan (and Sourcify): MarketSettlement `0x657C61e2a48769C9bf39Fa0A6E73985e0d1ec3ea`, LotFactory `0x5Dad44bA795D5aBcE4FCA9f460b118748A50A423`, ChainTrigger `0xf4a733D2dF2dA83C64f9490B3aDAaCEf087dEA96`, CCAFactory `0xA42F306165e73011F2636099BFdB9D52E9e18890`, AgentRegistry `0xda25852ccDE3f05ec29D5E1DC6127dA337cE6d70`, hook `0xdBD2c4c9A3301875cC70eA0AAfAC8bE60071a89f`, tUSD `0xeaba278034Fa040D3A7B706e1080663E73151C12`, tEUR `0x4791860111D492EA67Fb353c4DdFE4CB2815f7eC`. Superseded the same day: a first v1 with the old 60/300 windows (settlement `0x1d313EF07e7842D780Ae97C7430478cea316E8C9`). Don't use it.

**`forge script --verify` with `--root` fails.** Verification looks for `cache/solidity-files-cache.json` relative to the working directory, then reports "Unknown compilation profile: via_ir". Run forge from inside `contracts/`. Forge only loads `.env` from the working directory, so the scripts go through `scripts/with-env.ts` (D-51). `forge verify-contract` also needs `--compilation-profile default` because the cache holds two profiles. `--resume` needs `--broadcast` and re-runs the script, so check that the deployment file is unchanged afterwards (it was). Basescan sometimes stays "pending" past forge's retries; rerun `pnpm verify:base-sepolia`.

**Identical stub bytecode.** Both oracle stubs compile to the same code, so forge verified the SignalOracle stub under the name `StubDisputeResolver`. It's cosmetic; 4.1 replaces both.

**Same addresses on anvil and Base Sepolia.** The anvil fork starts from the deployer's real nonce, so the first anvil deploy predicted the same addresses that Base Sepolia later got. Don't confuse fork transactions with real ones; the anvil smoke links point at Basescan but don't exist there.

**CCA rounds `currencyRaised` down by up to one base unit per bid.** Two bids totalling €500.00 raised €499.999999. The unit is refunded to bidders on exit. The smoke allows `<= bids` units of dust.

**Smoke timing on real blocks.** With 20-block (4 s) auctions, sequential send-then-wait made the bids land after `endBlock` (`AuctionIsOver`, first in simulation, then on-chain). Fixes: 300-block smoke lot, and the two allowances and two bids sent back to back with explicit gas and nonces (no simulation against a not-yet-mined allowance), then receipts awaited together. `scripts/rpc-timing.ts` times each RPC step: about 0.2 to 0.5 s per call, 1.5 s per broadcast, mined next block.

**viem errors print the RPC URL.** The full message includes `URL: ...`, which can carry an API key. The smoke prints only `shortMessage`, details and the decoded revert reason, redacted (`safeErrorMessage`, tested). The keeper (2.1) must do the same.

**Gas.** v1 deploy ≈ 54M gas, about 0.00009 ETH at Base Sepolia fees (base 0.005 gwei). `createLot` ≈ 4.9M. On the anvil fork gas is priced higher, so the smoke sets balances locally there.

## 2026-11-06, S1 2.1

**Exit hints, read from source (`ContinuousClearingAuction.sol` 495 to 602).** `exitBid` only for `maxPrice > finalClearing` (no hints). `exitPartiallyFilledBid(id, lastFullyFilled, outbid)` for the rest: it checkpoints first, then requires `lastFullyFilled.clearing < maxPrice`, `next(lastFullyFilled).clearing >= maxPrice` and `lastFullyFilled >= bid.startBlock`; `outbid = 0` only when the final clearing equals `maxPrice`, otherwise `outbid.clearing > maxPrice` and `prev(outbid).clearing <= maxPrice`. The keeper's walk (`lib.exitHints`) is tested against `services/keeper/test/fixtures/exit-hints.json`, which `forge test` writes from a real 4-bid auction (`ExitHintFixtures.t.sol`) covering all three paths. A was outbid at block 121 (when D arrived), not when B arrived, so hand-picked hints would have been wrong.

**Settle already checkpoints the end block.** `sweepCurrency` has `ensureEndBlockIsCheckpointed`, so after `settle` the hints are final and the keeper needs no extra `checkpoint()` (the 1.4 smoke sends a redundant one).

**Exits and claims are permissionless.** Anyone can call `exitBid`, `exitPartiallyFilledBid` and `claimTokensBatch(owner, ids)` for any owner. A second exit reverts `BidAlreadyExited`; a second claim doesn't revert (it zeroes `tokensFilled` and transfers 0). The keeper reads `bids(id)` first either way. Our lots use `requiredCurrencyRaised = 0`, so they always graduate and `NotGraduated` can't happen.

**Contract gap: `assignCarrier` doesn't check the parent's sector.** A relisted truck lot has the old truck lot as `parentLotId` (1.3 note), so `assignCarrier(oldTruckLot, relistedTruckLot)` would succeed and make a truck the carrier of a truck lot. The keeper never plans it (`planCarriers` skips truck parents, unit-tested). **For S1 3.1/4.1:** add `if (Keys.isTruck(p.sector)) revert` in `assignCarrier`, or give relisted truck lots the goods lot as parent.

**Block boundaries.** Planners use the contract's own comparison at the current head (`head >= endBlock`, `head > contestEnds`, `head > pickupDeadline + reportWindow`), so `eth_estimateGas` at `latest` agrees with the plan and the tx mines at `head + 1` or later. No action is sent early.

**Polling, not filters.** Public RPCs drop `eth_newFilter` filters, so the keeper polls `eth_getLogs` (D-55): LotFactory and MarketSettlement in one call, then `BidSubmitted` only for auctions live in that block range. No confirmation depth: Base Sepolia reorgs are rare and every action re-reads the contract view before sending. Known limit: if a reorg removed a `LotSettled` the keeper already saw, it won't re-plan that settle until restart.

**Integration test chain (D-56).** First version forked Base Sepolia; 2 of 6 runs failed (anvil took over 60 s to answer once, a forge deploy hung ~550 s once), both on remote RPC latency. The deploy only needs code at Permit2 and the Circle test-token addresses, so the test now runs a plain `anvil --chain-id 84532`, sets the committed Permit2 runtime (Permit2 reuses its cached domain separator on 84532), and puts `0x00` at the Circle addresses. 3 of 3 passed in 6 to 10 s.

**forge script output paths.** `FOUNDRY_BROADCAST=<dir>` moves the broadcast record, so the test leaves `contracts/broadcast/` (committed) untouched. The script's sensitive cache still goes to `contracts/cache/Deploy.s.sol/84532/` (gitignored). `pnpm deploy:anvil` already writes there, because the fork is also chain 84532. Moving `cache_path` would force a full via-IR recompile of the CCA factory on every run.

**viem typing.** A public client created with `chain: baseSepolia` carries OP-stack formatters and isn't assignable to plain `PublicClient`. The keeper's public client has no chain (reads don't need the formatters); the wallet keeps `baseSepolia` for the chain id. CCA `uint64` fields (`exitedBlock`, `startBlock`) decode to `bigint`: typecheck caught an `=== 0` in the scenario script.

**The project RPC caps `eth_getLogs` at 200 blocks** ("eth_getLogs is limited to a 200 range"), found in the first live scenario run. That's 40 s of Base blocks. The keeper starts at 2,000 and now drops straight to the provider's stated limit after one rejection (`shrinkLogChunk`, tested with the exact error), otherwise it halves. Backfill from `deployedAtBlock` is about one call per 200 blocks. The scenario's explorer-link lookup searches back from the head in 200-block windows.

**Live run 1 findings (lots 11 to 13 on Base Sepolia, all resolved by the keeper, nothing held).**
- `tick failed: HTTP request failed. (fetch failed)` means the RPC request never completed (network or provider drop). The keeper retried and caught up, but the lot 12 release came ~240 s late and the lot 13 release ~140 s late. A dead connection cost up to 2 minutes per call (30 s timeout x 4 tries). Now 10 s x 3 tries; a failed pre-send read retries on the next tick instead of entering the exponential backoff meant for reverts; an `alive` heartbeat every 30 s and a `tick recovered` line show the keeper is alive.
- Cold start replayed every event since `deployedAtBlock` at 200 blocks per call, silently. At ~5 blocks/s that is thousands of calls a day of chain age; the second live start never finished its first tick. Now the keeper rebuilds state from views (D-59): `lotCount`, `getLot`, `saleOf`, CCA `nextBidId` per lot, and a `NoShowReported` scan only for lots with `reportedTokens > 0`, only inside their report window. Base Sepolia: 13 lots rebuilt in about 3 s. Integration test: a keeper restarted mid contest window finds the open report and finalizes it.
- Money for lot 12 adds up exactly: held 2,382.437116 = refund 212.810437 to the no-show buyer + 2,169.626679 released to the seller.
- **Contract status bug (display only, no money):** lot 12 had a finalized no-show refund but ends at `picked_up`, not `refunded` (D-44). `releaseExpired` sets `status = PICKED_UP` whenever `reportedTokens == 0`, overwriting `REFUNDED`. **For S1 3.1/4.1:** only set `PICKED_UP` when `!s.anyRefund`. Until then, the town should read `anyRefund` from `saleOf` (or `NoShowRefunded` events) rather than trust `statusOf` alone.

**Live run 2 (lots 14 and 15, Base Sepolia, block 55078120 onward): passed.** Every follow-up came from the keeper (`0x9C3c963E...`): checkpoints while live, settle, 3 partial exits plus 1 `exitBid`, 4 claims, the truck lot's settle, exit and claim, `assignCarrier(14, 15)`, `finalizeNoShow`, two `releaseExpired`. 27 sent, 27 mined, 0 reverted, 0 failed; 109 log lines, all info, no secrets. Delay from each deadline to the keeper's tx: settle 36 blocks (~7 s), refund 27 (~5 s), releases 24 and 29 (~5 s); run 1 had 140 to 240 s. Money is exact: lot 14 raised 4,811.016136 = 2,381.452987 advance + 2,381.452988 held + 48.110161 fee; held = 214.306359 refund + 2,167.146629 release. Lot 15 held 267.30 released, `LotPaidInFull`. Cold start rebuilt 13 lots from views in ~3 s. The scenario itself timed out on the release stage (its 5-minute stage limit is shorter than the 10-minute report window) while the keeper still released on time; the scenario now waits for the window first. Lot 14 also ended `picked_up` after a refund (the status overwrite above).

**Stream test command.** `bun test --cwd cre` can't run yet: `cre/` arrives in S1 4.2.

## Open questions

- Should `contracts/.env` be a symlink to `../.env`, so `forge test` works from inside `contracts/`? Not done. Run from the repo root.
