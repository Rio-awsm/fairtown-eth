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

## Open questions

- Should `contracts/.env` be a symlink to `../.env`, so `forge test` works from inside `contracts/`? Not done. Run from the repo root.
