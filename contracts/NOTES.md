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

## 2026-11-06, S1 3.1

**Already there from 1.3.** `relist` (strictly lower floor, burns unsold, new token), `requestStorage` (holders only), `TransportNeeded` only for produce, fish and flowers, and the 10% truck advance. 3.1 adds the floor minimum, sector roles and parents, and relisted truck lots as carriers.

**Minimum relist floor (D-60).** 50% of the chain's first floor, rounded up, at least `MIN_FLOOR_PER_UNIT`. The first floor is stored per relisted lot (`_rootFloor`), so a chain 9.00 -> 6.00 -> 4.50 stops at 4.50. Solidity can't read another contract's constant by name (`LotFactory.MIN_FLOOR_PER_UNIT` fails with error 9582), so settlement mirrors the 1000 and `test_relistFloor_roundsUpAndNeverBelowProductMinimum` asserts they match.

**Both 2.1 contract gaps are closed.** `assignCarrier` now reverts `NoTransport` for any lot that isn't produce, fish or flowers, so a truck lot can't be a carrier's parent. A relisted truck lot resolves its goods lot at settle (D-61). `releaseExpired` keeps `refunded` after a finalized no-show; it only sets `picked_up` when there was no refund.

**Ticks put the floor a hair under the stated price.** `floorToTick` rounds the Q96 floor down, so a bid of exactly `qty x floor` clears a few wei of tokens more than `qty`: cod at 9.00 with EUR 1,620 sold 180 kg + 9,678 wei, and 100 GPU hours sold 100 + 5,377 wei. Money is still exact (1,620.000000 raised). Two effects:
- relist would have relisted 419 kg of the remaining 420 (fixed, D-63)
- `LotSettled.soldUnits` and `TransportNeeded.qty` round up (D-42), so that lot reports 181 kg, not 180. That's a display issue only, no money. **Open:** decide in 4.1 whether `soldUnits` should ignore dust under `TOKEN_DUST` too

`soldTokens + unsold` can be 1 wei under supply (CCA rounding).

**Storage parents.** Storage lots may name a produce, fish or flowers lot as parent, but settlement never acts on it (direct handover, no carrier). `requestStorage` still accepts any lot whose tokens the caller holds, including compute lots; S2 only reacts for goods.

**ABIs not regenerated.** New errors (`FloorBelowMinimum`, `NoTransport`, `WrongRole`, `ParentNotAllowed`, `BadParent`) and the views `minRelistFloorOf` and `MIN_RELIST_FLOOR_BPS` arrive in `packages/shared/src/abi/generated.ts` with the v2 deploy in S1 4.1 (`pnpm deploy:*` runs `gen:abi`), under the 4.1 ICR. Until then, S2 can't decode these reverts by name. No section 7 signature or event changed. Base Sepolia v1 doesn't have any of 3.1; the keeper's `stillNeeded` check (`saleOf(truck).parentLotId === goods lot`) keeps it from sending a carrier the v1 contract would reject.

**Sizes.** MarketSettlement 18,151 B (was 17,510), LotFactory 13,146 B (was 12,572).

## 2026-11-06, S1 4.1

**CRE consumer pattern (Context7, CRE docs "Building consumer contracts").** `IReceiver.onReport(bytes metadata, bytes report)` with ERC-165 (`interfaceId` = `onReport` selector `0x805f2132`); metadata is `abi.encodePacked(workflowId, workflowName bytes10, workflowOwner)`, and the production forwarder appends a 2-byte report id, so the owner is read from bytes 42 to 62. The docs say simulation and production forwarders differ, hence `setForwarder` (D-67). **Doc mismatch:** Context7's forwarder-directory table shows placeholder-looking addresses (e.g. Base Sepolia simulation `0x8c7B4F1A…`) that don't match the guide's `0x82300bd7…`; the latter has 9 KB of code on Base Sepolia and was used. Confirm with `cre workflow supported-chains` once the CLI is installed.

**Stale guard (D-64, ICR-005).** Kinds 1 and 3 now end with `uint64 asOf`. The production KeystoneForwarder already refuses to deliver a transmission twice, but the simulation mock forwarder doesn't, so without `asOf` an old FX report could be replayed. Checked on the anvil fork: the mock forwarder (impersonated with `cast`) delivered EUR 0.92/USD, and the same report a second time reverted `StaleReport` (`0x4287e77f`).

**Rulings.** Quality disputes escrow the buyer's tokens in the resolver; no-show tokens stay in settlement's escrow. `resolveRuling` tells them apart by the contested no-show report, burns from the right holder, and works after `releaseExpired` because disputed tokens stay in `reportedTokens`. A buyer can't have a no-show report and a quality dispute open on the same lot. Disputes end by ruling or by `expireDispute` after `RULING_TIMEOUT_BLOCKS` (D-65), which the keeper now sends. Exact numbers: EUR 1,000 raised, new seller, held 495; a 40% ruling pays the buyer 198.000000 and the seller 297.000000; a proven seller's upheld no-show refunds all 99.000000.

**Wiring (D-41 extended).** The deploy script predicts MarketSettlement at nonce +2 and DisputeResolver at +3, so LotFactory (LotToken escrow rights), settlement and the resolver hold each other immutably. Fixtures do the same.

**`gen:abi` and stale artifacts.** wagmi failed with `Contract name "DisputeResolver" must be unique`, then the same for `MarketSettlement`: building once from `contracts/` and once with `--root contracts` from the repo root left two artifact trees (`out/X.sol/` and `out/src/X.sol/`, `out/oracles/X.sol/`). Deleting the stale trees fixed it. Prefer running forge from `contracts/`; if `gen:abi` reports a duplicate name, look for nested `out/src` or `out/oracles` folders.

**Lints.** Same scoped `reentrancy-no-eth`/`reentrancy-events` disable as MarketSettlement for DisputeResolver (OZ guard false positive); `openDispute` reordered so the record and event come before the settlement call and the escrow. `block-timestamp` is disabled on the two freshness comparisons (wall-clock report times, one-hour window).

**Sizes.** MarketSettlement 20,249 B (was 18,151; 4.3 KB headroom), DisputeResolver 5,519 B, SignalOracle 4,268 B, LotFactory 13,146 B.

**`pnpm deploy:anvil` overwrites the Base Sepolia broadcast record.** The fork has chain id 84532, so forge writes `contracts/broadcast/Deploy.s.sol/84532/run-latest.json` (committed, Base Sepolia v1) plus a new `run-<ts>.json`. After the 4.1 anvil deploy both were reverted by hand. The Base Sepolia v2 deploy will write the real record. **Open:** point the anvil deploy at its own broadcast folder (`FOUNDRY_BROADCAST`, as the keeper test does).

**Deployed v2 on Base Sepolia** at block 55124830, commit `254458e`, all 10 verified on Basescan (6 new, 4 "Already Verified": same bytecode as v1). MarketSettlement `0xdE3Cd8C735d55F338baFe05Ecd2F1EAF2Af25b07`, LotFactory `0x713E4eF64b97160bd366118457E3F4B486cFf1Cd`, DisputeResolver `0xCb8bC2340caC7AB351e05c7FB26878018c88aaBc`, SignalOracle `0x8B0eE1395ee575D234ae5dDE927062B646A685B2`, ChainTrigger `0xc80872791FFbb6CF36cEaE9B3301aB180D137250`, AgentRegistry `0xd934Bff26fd3984cF335d281774147E9c382A8C1`, hook `0x277451a909edb6dCd2143Bd9468d8D2757D4aaa1`, CCAFactory `0x3909BC64F4551F00eA74475220442a516769032C`, tUSD `0x6B7d294a1b8A44699f294F444Ff01EffcFEa0631`, tEUR `0x7F016D411F20B98D014d5d80A3d78bB446da6d8a`. The anvil rehearsal predicted the same addresses (same deployer nonce, 1.4 note). Wiring read back over the public RPC: settlement, factory and resolver point at each other, timeout 3000, both receivers on the mock forwarder, ERC-165 `IReceiver` true. Cost about 0.00014 ETH. `pnpm smoke:base-sepolia` passed on v2 (lot 1 to `paid_in_full`, EUR 499.999999 raised, seller EUR 495). v1 tokens, agents and lots don't carry over: agents must be registered and funded again on the new registry and stables.

**v1 archived** at `deployments/archive/base-sepolia-v1.json`. The keeper still runs against v1: reading `rulingTimeoutBlocks` from the stub reverts, so dispute handling switches off with one warning (a network error is still thrown).

## 2026-11-06, S1 4.2

**CRE CLI v1.39.0 and SDK 1.23.0.** Installed with the official script once the network's GitHub API quota (60 anonymous calls an hour) reset; the script needs one API call to find the release. `cre workflow supported-chains` for this account: Base Sepolia selector `10344971235874465080`, mock forwarder `0x82300bd7…`, production forwarder `0xF8344CFd…`. Deploy access is not enabled, so W1 runs in simulation only. Limits (`cre workflow limits export`): 10 chain writes, 15 HTTP calls, 50 consensus calls per execution; HTTP timeout at most 10 s; execution 5 min.

**Frankfurter.** `/v2/rates?base=USD&quotes=EUR,NOK,INR,KES,NGN` returns `[{date, base, quote, rate}]` for all five; v1 `/latest` lacks KES and NGN. Rates are JSON numbers: they are turned back into their decimal text (shortest round trip, exponents refused) and scaled to `perUsdE8` exactly.

**Doc and source mismatches (CRE).**
- Javy (the WASM compiler) refuses exported functions with parameters in the entry file: "Exported functions with parameters are not supported". `main.ts` exports only `main`; the logic is in `src/workflow.ts`.
- zod `.url()` fails inside WASM (no `URL` built-in): config validation said "Invalid URL" for valid URLs. A regex is used.
- In simulation the cron payload's `scheduledExecutionTime` is the **next** slot, not now, and the simulator's log timestamps are local time with a `Z` suffix (13:23 "Z" was 07:53 UTC). The first broadcast stamped reports 36 min ahead of block time; SignalOracle's stale guard rejected all ten (`ReportFromFuture`), the forwarder swallowed it (`ReportProcessed(..., false)`), and the simulator still printed success. Fixed by DON time (D-69).
- `ConsensusAggregationByFields` takes the field factories themselves (`median`, `identical`), not their results. `ReceiverContractExecutionStatus` is not exported from the SDK entry; its values (0 success, 1 reverted) come from the generated `client_pb`. The SDK fills a missing receiver status with 0, so success can't be told from "not reported".
- Context7's forwarder directory table shows placeholder-looking addresses; the CLI's own `supported-chains` is the source.

**Broadcasts (Base Sepolia, CRE wallet `0xF678…5338`).** First run: 10 txs mined, 0 values stored (logs `*-FAILED-asof-*`). Second run after D-69: 10 of 10 landed, verified from receipts and SignalOracle views (`cre/logs/w1-fx-reference-verify-onchain-2026-11-06.log`). EUR 0.88915, NOK 9.2757, INR 94.45, KES 129.81, NGN 1346.12 per USD; cod@bergen 8.30 EUR, tomato@lagos 0.38, marigold@mumbai 0.95, gpu_hour@any_dc 2.00, truck_capacity@dallas 0.055 USD (base units in the log).

**Reference data is illustrative.** `/api/reference` (stream-2-brain `services/agents`, run from a detached worktree with no `.env`, so fake chain, in-memory Arkiv and mock AI) dates every price 2026-11-05 with source "illustrative"; cod says "replace with the Rafisklaget minimum price before the demo". W1 publishes what the service says and logs that source; S2 owns replacing the data.

## 2026-11-06, S1 4.3

**Open-Meteo.** One `/v1/forecast` request with comma-separated coordinates returns a list in request order (Context7 and live check). On 2026-11-06 all five places were calm (gusts 15 to 40 km/h, rain 0 to 8.5 mm), so the real-world levels (D-13) produced no weather signal; the demo storm has to be forced and labelled (SoT scene 1). Weather numbers are not money; plain JS numbers.

**Calendar.** Diwali (Lakshmi Puja) on Sun 8 Nov 2026 is real and two days away: W2 wrote "Diwali in 2 days" for Mumbai and Pune (severity 4), expiring at the end of 8 Nov UTC (block 56,302,656 from head 55,155,xxx at 5 blocks/s). The forced "Valentine's cargo cutoff (forced)" for Nairobi expires 6 h after the run.

**Block rate confirmed.** Base Sepolia: 500,000 blocks in exactly 100,000 s (5.0 blocks/s), head time equal to wall-clock time. D-50 holds.

**Broadcast.** 3 of 3 `DemandSignal`s landed and matched field by field (`cre/logs/w2-signals-verify-onchain-2026-11-06.log`); `SignalOracle.signalCount` = 3. The weather broadcast sent nothing (calm). The CRE `headerByNumber(LATEST_BLOCK_NUMBER)` reply gives `blockNumber` as a proto BigInt (`protoBigIntToBigint`) and `timestamp` in seconds.

**S2 alignment.** Labels follow the agents director (`calendarLabel`, `forced()`), and the director already posts `{ workflow: "w2-signals", forceSignals: [...] }` to the CRE bridge: S1 4.5 must accept that shape and route it to this workflow's forced path.

## 2026-11-06, S1 4.5

**4.4 set aside.** maxspxtr moved on to 4.5 before any W3 code was written. The bridge's W3 path (watch `DisputeOpened` on the DisputeResolver, run `w3-rulings` with `--evm-tx-hash` and the event index within the tx) is built and tested with a fake `cre`; its health shows `w3-rulings` as not built, and a W3 request fails with "not built yet" without calling the CLI.

**Live bridge runs found four things the unit tests could not.**
- **Shared signing key.** Parallel W1 and W2 runs sign with the same `CRE_ETH_PRIVATE_KEY`: "nonce too low: next nonce 36, tx nonce 35"; W1 had already written 4 of 5 values. Broadcasting runs now take turns across all workflows (D-73).
- **`--config` path.** The CLI rejects paths over 97 characters ("ConfigPath must be a maximum of 97 characters") and resolves relative paths from the workflow folder (checked: `./config.json` works, `w2-signals/config.json` doesn't). macOS temp paths are longer; the forced config now sits next to W2's config as `./.forced-<id>.json` (gitignored, deleted after the run).
- **Online login check per run.** Every `cre workflow simulate` validates the login at `api.cre.chain.link`; once it failed with "TLS handshake timeout". The bridge retries once, only when the failure came before the workflow ran. **Demo risk:** the simulator needs internet and a valid `cre login`.
- **Unreachable source aborts a run.** With the agents service down, `connection refused` made `.result()` throw and the whole W1 reference run failed. Fixed in W1 and W2 (D-74): now "0 written, 5 skipped".

**Redaction caught a real leak.** The CLI printed the RPC URL in an error ("failed RPC health check: Post \"…\""); the bridge log has `<RPC_URL>` there. Placeholders like `change-me` are no longer treated as secrets (they garbled the "still change-me" message).

**Real runs (Base Sepolia, final bridge build).** Timers at start: W1 FX 5 written, W1 reference 0 written 5 skipped (service off), W2 weather 0 (calm), W2 calendar 3; then the director's body by `POST /run`: "Storm forecast, Bergen (forced)" written with its exact `expiresAtBlock`. All five strictly one after another. Verified on chain from the bridge logs: FX 5 of 5, signals 4 of 4 (`signalCount` 13). Wrong token: 401. Bridge stopped afterwards so its timers don't keep spending test ETH.

## Open questions

- Should `contracts/.env` be a symlink to `../.env`, so `forge test` works from inside `contracts/`? Not done. Run from the repo root.
