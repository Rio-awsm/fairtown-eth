# Fairtown contracts (Stream 1)

Foundry project for lots, the Uniswap CCA auctions and staged payouts. Rules: `CLAUDE.md`. Gotchas: `NOTES.md`.

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
| `pnpm test:contracts` | `forge test --root contracts`. Loads the repo `.env`, so fork tests run |
| `forge build --root contracts --sizes` | Build and show contract sizes |
| `pnpm chain:fork` | Anvil fork of Base Sepolia on :8545, chain ID 84532, RPC URL redacted from output |
| `pnpm run doctor` | Toolchain, CCA pin, RPC, chain ID, wallet balances (deployer, keeper, operator), deployment file and contract code |
| `pnpm deploy:anvil` | Deploy v1 to the running fork, write `deployments/anvil.json`, regenerate ABIs |
| `pnpm deploy:base-sepolia` | Deploy v1 to Base Sepolia, verify on Basescan, write `deployments/base-sepolia.json`, regenerate ABIs |
| `pnpm verify:base-sepolia` | Resume verification only (Basescan sometimes stays pending) |
| `pnpm gen:abi` | wagmi: ABIs for our contracts, CCA and Permit2 to `packages/shared/src/abi/generated.ts` |
| `pnpm smoke:anvil`, `pnpm smoke:base-sepolia` | One real lot from listing to `paid_in_full`, with explorer links |

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
