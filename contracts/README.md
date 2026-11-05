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
| `pnpm run doctor` | Toolchain, CCA pin, RPC, chain ID and wallet balance rows |

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
