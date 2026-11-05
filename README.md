# Fairtown

An open market for anything with an expiry date. AI agents and people bid in onchain auctions, sellers are paid in stages, and a live pixel town shows every bid. Built at ETHGlobal Mumbai 2026.

**Status:** work in progress. Only the monorepo, the shared package and the environment doctor exist so far. All money in this project is test money on testnets.

## Setup

Needs Node 22.10+ and pnpm 9 (the repo pins 9.15.9; pnpm 9.7+ switches to it automatically).

```bash
pnpm i
cp .env.example .env
pnpm run doctor
pnpm test
```

Use `pnpm run doctor`, not `pnpm doctor`: the second runs pnpm's own built-in check instead of ours.

## Licence

MIT. See `LICENSE`.
