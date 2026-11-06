# Keeper (S1 2.1)

Makes sure auctions and deadlines never wait on a person. It holds only `KEEPER_PRIVATE_KEY`, and every action can safely run twice.

| Module | Does |
| --- | --- |
| `src/state.ts` | Polls logs (`LotListed`, `LotSettled`, `CarrierAssigned`, `NoShowReported`, `NoShowContested`, `NoShowRefunded`, `BidSubmitted`) and rebuilds state from `deployedAtBlock` on every start (D-55) |
| `src/checkpointer.ts` | `checkpoint()` on a live auction with bids after `KEEPER_CHECKPOINT_BLOCKS` (default 25) quiet blocks (D-54) |
| `src/settler.ts` | `settle` from `endBlock`, including zero-bid lots |
| `src/exits.ts` | After settle: `exitBid` or `exitPartiallyFilledBid` with checkpoint hints, then `claimTokensBatch` per owner |
| `src/deadlines.ts` | `assignCarrier` for chained truck lots (a relisted truck lot serves its chain's goods lot, D-61; never storage or compute lots), `finalizeNoShow` after the contest window, `releaseExpired` after the report window (each lot's own pickup window, so GPU lots release first); `expireDispute` after the ruling timeout (S1 4.1, D-65; off on a v1 deployment) |
| `src/txQueue.ts` | Re-checks each action before sending, classifies reverts (D-58), uses consecutive nonces, bumps fees on stuck txs, resyncs the nonce |

```sh
pnpm -F keeper dev base-sepolia      # or anvil; without an argument it uses CHAIN_MODE
pnpm -F keeper scenario base-sepolia # live check: lists and bids, then waits for the running keeper (~15 min)
pnpm -F keeper status base-sepolia 12 13   # read-only: settle, exits, carrier, held, status per lot
pnpm -F keeper events base-sepolia 12 <fromBlock>  # read-only: one lot's settlement events, sender, links
pnpm -F keeper test                  # unit tests + integration test on a local anvil (needs Foundry, no RPC)
```

Logs are JSON (pino, `LOG_LEVEL`). Quiet ticks log nothing; an `alive` line every 30 s shows head, cursor and queue stats. `tick failed` with `fetch failed` means the RPC was unreachable: the keeper retries each poll and logs `tick recovered`. Keys and the RPC URL are never logged. TEST MONEY only.

## CRE bridge (S1 4.5)

`pnpm -F keeper cre:bridge` runs the CRE workflows through the **simulator** (`cre workflow simulate --broadcast`: real Base Sepolia test transactions through the mock forwarder, not a CRE network). Timers for W1 and W2 (`CRE_BRIDGE_*_MINUTES`, 0 = off), one W3 run per `DisputeOpened`, and `POST :8789/run` with `Authorization: Bearer $CRE_BRIDGE_TOKEN` (contract 11.1). With broadcast on, one run at a time overall (shared `CRE_ETH_PRIVATE_KEY`). Each run's output is saved, redacted, under `cre/logs/bridge/<date>/`. `GET /health` shows what is built, running and queued. Needs internet and `cre login`: the CLI checks the login online on every run.

