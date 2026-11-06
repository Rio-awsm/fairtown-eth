# Keeper (S1 2.1)

Makes sure auctions and deadlines never wait on a person. It holds only `KEEPER_PRIVATE_KEY`, and every action can safely run twice.

| Module | Does |
| --- | --- |
| `src/state.ts` | Polls logs (`LotListed`, `LotSettled`, `CarrierAssigned`, `NoShowReported`, `NoShowContested`, `NoShowRefunded`, `BidSubmitted`) and rebuilds state from `deployedAtBlock` on every start (D-55) |
| `src/checkpointer.ts` | `checkpoint()` on a live auction with bids after `KEEPER_CHECKPOINT_BLOCKS` (default 25) quiet blocks (D-54) |
| `src/settler.ts` | `settle` from `endBlock`, including zero-bid lots |
| `src/exits.ts` | After settle: `exitBid` or `exitPartiallyFilledBid` with checkpoint hints, then `claimTokensBatch` per owner |
| `src/deadlines.ts` | `assignCarrier` for chained truck lots, `finalizeNoShow` after the contest window, `releaseExpired` after the report window |
| `src/txQueue.ts` | Re-checks each action before sending, classifies reverts (D-58), uses consecutive nonces, bumps fees on stuck txs, resyncs the nonce |

```sh
pnpm -F keeper dev base-sepolia      # or anvil; without an argument it uses CHAIN_MODE
pnpm -F keeper scenario base-sepolia # live check: lists and bids, then waits for the running keeper (~15 min)
pnpm -F keeper status base-sepolia 12 13   # read-only: settle, exits, carrier, held, status per lot
pnpm -F keeper events base-sepolia 12 <fromBlock>  # read-only: one lot's settlement events, sender, links
pnpm -F keeper test                  # unit tests + integration test on a local anvil (needs Foundry, no RPC)
```

Logs are JSON (pino, `LOG_LEVEL`). Quiet ticks log nothing; an `alive` line every 30 s shows head, cursor and queue stats. `tick failed` with `fetch failed` means the RPC was unreachable: the keeper retries each poll and logs `tick recovered`. Keys and the RPC URL are never logged. TEST MONEY only.
