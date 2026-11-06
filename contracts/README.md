# Fairtown contracts (Stream 1)

Foundry project for lots, the Uniswap CCA (v2.1.0) auctions, staged payouts and the Chainlink CRE receivers. Rules: `CLAUDE.md`. Gotchas, findings and every doc-vs-source mismatch: `NOTES.md`. Decisions: `../DECISIONS.md`.

**What this is:** testnet code on Base Sepolia with test money (tUSD, tEUR). Not audited. CRE workflows run in the CRE **simulator** (`cre workflow simulate --broadcast`), not on a CRE network. Agents are AI, and every AI result is labelled as one.

## Setup

Needs Foundry 1.x and Bun 1.2+ (`pnpm run doctor` checks both).

```sh
git submodule update --init contracts/lib/continuous-clearing-auction
git -C contracts/lib/continuous-clearing-auction -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init --recursive
git -C contracts/lib/continuous-clearing-auction describe --tags   # must print v2.1.0
```

The HTTPS rewrite is needed because a nested CCA dependency uses an SSH URL (see `NOTES.md`).

## Commands (run from the repo root)

| Command | Does |
| --- | --- |
| `pnpm test:contracts` | `forge test --root contracts`. Loads the repo `.env`, so the Base Sepolia fork tests run too |
| `forge build --root contracts --sizes` | Build and show contract sizes (all under EIP-170) |
| `pnpm chain:fork` | Anvil fork of Base Sepolia on :8545, chain ID 84532, RPC URL redacted from output |
| `pnpm run doctor` | Toolchain, CCA pin, RPC, chain ID, wallet balances (deployer, keeper, operator, CRE key), deployment file and contract code |
| `pnpm deploy:anvil` / `pnpm deploy:base-sepolia` | Deploy v2 (with the CRE receivers), write `deployments/<network>.json`, regenerate ABIs; Base Sepolia also verifies on Basescan |
| `pnpm verify:base-sepolia` | Resume verification only (Basescan sometimes stays pending) |
| `pnpm gen:abi` | wagmi: ABIs for our contracts, CCA and Permit2 to `packages/shared/src/abi/generated.ts` |
| `pnpm smoke:anvil` / `pnpm smoke:base-sepolia` | One real lot from listing to `paid_in_full`, with explorer links |

## Deployed (Base Sepolia, v2)

Block 55124830, commit `254458e`, all verified on Basescan. Addresses in `../deployments/base-sepolia.json`; v1 is archived in `../deployments/archive/`. MarketSettlement [`0xdE3C…5b07`](https://sepolia.basescan.org/address/0xdE3Cd8C735d55F338baFe05Ecd2F1EAF2Af25b07), LotFactory [`0x713E…f1Cd`](https://sepolia.basescan.org/address/0x713E4eF64b97160bd366118457E3F4B486cFf1Cd), DisputeResolver [`0xCb8b…aaBc`](https://sepolia.basescan.org/address/0xCb8bC2340caC7AB351e05c7FB26878018c88aaBc), SignalOracle [`0x8B0e…85B2`](https://sepolia.basescan.org/address/0x8B0eE1395ee575D234ae5dDE927062B646A685B2).

## Where we touch the CCA (exact v2.1.0 lines)

Every CCA call goes through one of these. Left: CCA source at the pinned tag (also in `lib/continuous-clearing-auction/src/`). Right: our call site.

| What | CCA v2.1.0 | Ours |
| --- | --- | --- |
| Create an auction | [`ContinuousClearingAuctionFactory.sol:25`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuctionFactory.sol#L25) `create` | [`src/LotFactory.sol:200`](src/LotFactory.sol#L200) |
| Auction parameters | [`interfaces/IContinuousClearingAuction.sol:16`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/interfaces/IContinuousClearingAuction.sol#L16) `AuctionParameters` | [`src/LotFactory.sol:187`](src/LotFactory.sol#L187) (tick spacing 194, hook 195) |
| Supply schedule (`auctionStepsData`) | [`libraries/StepLib.sol:23`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/libraries/StepLib.sol#L23) `parse`: `bytes8 = uint24 mps + uint40 blockDelta`, MPS = 1e7 ([`libraries/ConstantsLib.sol:8`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/libraries/ConstantsLib.sol#L8)) | [`src/libraries/Schedules.sol:19`](src/libraries/Schedules.sol#L19) `endWeighted` |
| Fund and activate | [`ContinuousClearingAuction.sol:119`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L119) `onTokensReceived` | [`src/LotFactory.sol:203`](src/LotFactory.sol#L203) (same tx as create) |
| Who may bid | [`interfaces/IValidationHook.sol:13`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/interfaces/IValidationHook.sol#L13) `validate` | [`src/registry/AgentRegistryHook.sol:25`](src/registry/AgentRegistryHook.sol#L25) |
| Bid (pulls currency through Permit2) | [`ContinuousClearingAuction.sol:464`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L464) `submitBid`, Permit2 pull at [`ContinuousClearingAuction.sol:479`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L479)  | agents (S2); tests: `test/utils/LotFixture.sol` `_bid` |
| Checkpoint / clearing price | [`ContinuousClearingAuction.sol:420`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L420) `checkpoint`, [`ContinuousClearingAuction.sol:240`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L240) `_checkpointAtBlock`, [`ContinuousClearingAuction.sol:156`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L156) `clearingPrice` | keeper `services/keeper/src/checkpointer.ts` (D-54) |
| Settle: sweep money and unsold tokens | [`ContinuousClearingAuction.sol:663`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L663) `sweepCurrency`, [`ContinuousClearingAuction.sol:687`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L687) `sweepUnsoldTokens` (both checkpoint the end block, [`ContinuousClearingAuction.sol:111`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L111) ) | [`src/MarketSettlement.sol:300`](src/MarketSettlement.sol#L300) |
| Sold amount and final price | [`AuctionStorage.sol:131`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/AuctionStorage.sol#L131) `totalCleared`, [`ContinuousClearingAuction.sol:156`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L156) `clearingPrice` | [`src/MarketSettlement.sol:305`](src/MarketSettlement.sol#L305) |
| Exit bids | [`ContinuousClearingAuction.sol:495`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L495) `exitBid`, [`ContinuousClearingAuction.sol:514`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L514) `exitPartiallyFilledBid` (hints: `NOTES.md`, S1 2.1) | `services/keeper/src/exits.ts:25` and `:27`, hints `services/keeper/src/lib.ts:57` |
| Claim tokens | [`ContinuousClearingAuction.sol:604`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L604) `claimTokens`, [`ContinuousClearingAuction.sol:617`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L617) `claimTokensBatch` | keeper `services/keeper/src/exits.ts` |
| Checkpoint list and bids (views) | [`CheckpointStorage.sol:51`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/CheckpointStorage.sol#L51) `checkpoints`, [`BidStorage.sol:54`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/BidStorage.sol#L54) `nextBidId`, [`BidStorage.sol:59`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/BidStorage.sol#L59) `bids` | keeper cold start and exit hints |
| Graduation | [`ContinuousClearingAuction.sol:161`](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/ContinuousClearingAuction.sol#L161) `isGraduated` | always graduates: `requiredCurrencyRaised = 0` |

Prices: Q96 (`perUnit * 2^96 / 1e18`) in [`src/libraries/PriceMath.sol:18`](src/libraries/PriceMath.sol#L18); tick = floor / 100 ([`:27`](src/libraries/PriceMath.sol#L27)), floor rounded down to a tick ([`:32`](src/libraries/PriceMath.sol#L32)), which is why CCA can clear a few wei over a whole unit (D-63).

## Tests

| Suite | What |
| --- | --- |
| `test/integration/` | LotFactory on real CCA, MarketSettlement (payouts, handover, no-show, carriers), market extensions (relists, trucks, storage, compute), rulings |
| `test/invariant/Settlement.invariant.t.sol` | Random handovers, no-shows, contests, disputes, rulings, expiries, releases and time on real CCA lots. Held money equals the settlement balance; lot tokens are conserved; after all windows no currency is stuck and seller + buyers + treasury == raised |
| `test/unit/` | Registry, hook, tokens, PriceMath (20 shared vectors), schedules, keys, SignalOracle |
| `test/fork/` | Base Sepolia fork: Permit2 is canonical, a lot through real Permit2, the deploy script (v2) and the real mock forwarder delivering a report |

Gas: `gas-report.txt` (per function) and `.gas-snapshot` (per test), from `forge test --gas-report` and `forge snapshot` without the fork and invariant suites. `createLot` is about 4.9M gas (it deploys a CCA auction and a token).

## Dependencies

All pinned through CCA v2.1.0 (`lib/continuous-clearing-auction`). Nothing else is vendored and CCA source is never copied into `src/`.

| Import prefix | Path | Version |
| --- | --- | --- |
| `continuous-clearing-auction/` | `lib/continuous-clearing-auction/src/` | v2.1.0 (`a56d422`) |
| `@openzeppelin/contracts/` | CCA `lib/openzeppelin-contracts` | 5.3.0 (`e4f7021`) |
| `permit2/` | CCA `lib/permit2` | `cc56ad0`, canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| `solady/` | CCA `lib/solady` | v0.1.23 (`2af0640`) |
| `forge-std/` | CCA `lib/forge-std` | v1.9.7 |

## Compiler

Solidity 0.8.26, optimizer 200 runs. The CCA factory alone compiles via IR at 11111 runs, mirroring CCA's own `foundry.toml`.

## Deployments

`deployments/<network>.json` (contract section 8) is the only source of addresses; services never hard-code them. Base Sepolia v1: see `contracts/NOTES.md` (S1 1.4). Oracles are reverting stubs until S1 4.1 (D-48).

**Block time:** Base makes about 5 blocks per second. Every window is in blocks (D-50): contest 600 (~2 min), report 3000 (~10 min).

Deploys run forge from `contracts/` through `scripts/with-env.ts`, which loads the repo `.env` and redacts secrets from output (D-51).
