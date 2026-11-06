# CRE workflows (Stream 1)

Chainlink CRE workflows in TypeScript (`@chainlink/cre-sdk` 1.23.0, Bun). Simulation only: the account has no deploy
access, and CRE network deployment is in the backlog. Receivers: `SignalOracle` and `DisputeResolver` (contract 7.7,
7.8), which accept only the Base Sepolia mock forwarder `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5`
(`cre workflow supported-chains`, 2026-11-06).

| Workflow | Triggers | Writes |
| --- | --- | --- |
| `w1-fx-reference` (S1 4.2) | 0: FX cron, 1: reference cron | kind 3 per quote, kind 1 per D-16 pair |

## Run

```bash
bun install --cwd cre/w1-fx-reference          # once
bun test --cwd cre                              # pnpm test:cre
# Simulate from the repo root; with-env loads .env and redacts keys and RPC URLs from the output.
pnpm -s -F scripts run with-env --cwd cre -- cre workflow simulate ./w1-fx-reference \
  --target local-simulation --non-interactive --trigger-index 0            # add --broadcast to write
# Trigger 1 reads GET /api/reference from the agents service (services/agents, port 8787).
# After a broadcast, prove it landed (the simulator's "written" is not proof, D-69):
cd cre/w1-fx-reference && bun scripts/verify-onchain.ts ../logs/<broadcast log>...
```

`--broadcast` needs `CRE_ETH_PRIVATE_KEY` funded on Base Sepolia (`pnpm run doctor`, row `cre-wallet`). Logs of every
green-light run are in `logs/`.
