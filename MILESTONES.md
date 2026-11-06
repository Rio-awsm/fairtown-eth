# Milestones

One row per step. Status: todo, in progress, green, cut. Updated through MILESTONE_SYNC.md.

| ID | Title | Owner | Status | Started | Green at | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C 0.1 | Monorepo, shared package and doctor | Rio-awsm | tests green, open | 2026-11-05 |  | uncommitted | 97 tests pass; manual checks done; money code reviewed by Rio-awsm. Open: `pnpm test:all` needs Foundry and Bun (S1 0.1); use `pnpm run doctor` (scripts/NOTES.md) |
| C 1.1 | Chain and Brains |  | todo |  |  |  |  |
| C 1.2 | Brains and Town |  | todo |  |  |  |  |
| C 1.3 | First full lot, QR to paid in full (0 to 1) |  | todo |  |  |  |  |
| C 2.1 | Chainlink in the loop |  | todo |  |  |  |  |
| C 2.2 | Arkiv end to end |  | todo |  |  |  |  |
| C 2.3 | Full day end to end |  | todo |  |  |  |  |
| C 3.1 | Demo hardening, fallbacks, rehearsals |  | todo |  |  |  |  |
| C 3.2 | Sponsor deliverables and docs |  | todo |  |  |  |  |
| C 3.3 | Video, submission, finalist prep |  | todo |  |  |  |  |
| S1 0.1 | Toolchain and dependencies | maxspxtr | green | 2026-11-06 | 2026-11-06 | uncommitted | forge 10/10 (incl. 4 Base Sepolia fork); TS 115 pass; doctor exit 0; CCA v2.1.0. Full second review and line-by-line key review waived by maxspxtr; quick checks by Claude instead (prompt log). Stream cmd: `cre/` and keeper parts arrive in 4.2 and 2.1 |
| S1 1.1 | Base contracts | maxspxtr | tests green, open | 2026-11-06 |  | uncommitted | forge 64/64 (incl. hook on real CCA v2.1.0, schedule sweeps 2..500 x 0..9000); shared 101/101 incl. 20 price vectors (ICR-001). Open: read hook against CCA interface (manual), D-38/D-39 review |
| S1 1.2 | LotFactory on CCA | maxspxtr | tests green, open | 2026-11-06 |  | uncommitted | forge 85/85 incl. Base Sepolia fork lot through real Permit2; spread 4.5% at share 7500 (10.7% at 5000, D-40); LotFactory 12,572 B; events checked. Open: read one -vvvv trace (manual), mentor on sniping |
| S1 1.3 | MarketSettlement and ChainTrigger | maxspxtr | tests green, open | 2026-11-06 |  | uncommitted | forge 116/116 (settlement 31 incl. fuzzed payout invariant and no-stuck-currency, 256 runs each); exact guide balances; MarketSettlement 17,510 B. Open: human line-by-line read of settlement, mentor review booked, D-44/D-46/D-47 review, hand-recompute one settlement from a trace |
| S1 1.4 | Deploy v1 and publish | maxspxtr | tests green, open | 2026-11-06 |  | uncommitted | Base Sepolia v1 deployed and all 10 verified (settlement 0x657C61e2a48769C9bf39Fa0A6E73985e0d1ec3ea); smoke passed on anvil and Base Sepolia (lot to paid_in_full); ABIs generated; forge 117, TS 157. Found ~200 ms blocks: windows x10 (D-50, ICR-003). Open: post 'S1 v1 deployed', S2 to scale auction durations |
| S1 2.1 | Keeper service | maxspxtr | tests green, open | 2026-11-06 |  | uncommitted | keeper 72/72 incl. local-anvil integration (4-bid auction with keeper checkpoints, settle, both exit kinds, claims, zero-bid lot, carrier, no-show finalize, release; fresh second keeper sends 0, 0 reverts); hint tests from a forge fixture; forge 118. D-54 to D-59, ICR-004. Live run 1: lots 11 to 13 resolved (late releases on network drops, fixed). Live run 2: lots 14 and 15 passed, 27 keeper txs, 0 reverts, deadlines met within ~5 s, money exact. Open: human line-by-line read of txQueue, exits and deadlines; `assignCarrier` truck-parent gap and `releaseExpired` status overwrite for 3.1 (NOTES) |
| S1 3.1 | Relists, capacity and compute lots | maxspxtr | tests green, open | 2026-11-06 |  | 3681a36 (PR #9) | forge 137 (MarketExtensions 14 incl. 256-run floor fuzz); keeper 78 incl. anvil relist chain, relisted truck carrier, GPU and storage lots. Cod 600 kg at 9.00 sells 30%, relist at 7.65 sells the rest, money exact. D-60 (relists never below 50% of the first floor), D-61 to D-63; closed both 2.1 contract gaps. Not deployed (v2 in 4.1). Open: read a relist trace (manual), review D-61 to D-63 |
| S1 4.1 | Receivers, rulings, deploy v2 | maxspxtr | green | 2026-11-06 | 2026-11-06 | 254458e, a5588f1 (PR #10, #11) | forge 164 (Rulings 13 incl. extended money invariant, SignalOracle 14); keeper 87 incl. forwarder ruling and keeper `expireDispute` on anvil. 40% refund exact (198/297 of 495). v2 on Base Sepolia at block 55124830, all 10 verified, smoke passed; forwarder impersonated on the fork. D-64 to D-68, ICR-005. "S1 v2 deployed" posted. Open: confirm forwarder with the `cre` CLI (4.2), line-by-line read of `resolveRuling` and `DisputeResolver`, review D-67, D-68 |
| S1 4.2 | W1, FX and reference prices | maxspxtr | green | 2026-11-06 | 2026-11-06 | 75f3659 (PR #13) | `bun test --cwd cre` 27 (parsers, handlers with newTestRuntime + HttpActionsMock + EvmMock, on-chain verifier); dry runs 5/5 + 5/5; `--broadcast` on Base Sepolia 10 of 10 landed, checked by `verify-onchain.ts` from receipts and SignalOracle views; logs in `cre/logs/`. First broadcast stored nothing (simulator's cron time is the next slot, D-69). D-16, D-69 to D-71; forwarder confirmed by `cre workflow supported-chains`. Reference data is S2's illustrative snapshot. Open: browser comparison of one rate not recorded (Claude compared via API: 0.88913 live vs 0.88915 stored), review D-69 to D-71 |
| S1 4.3 | W2, demand signals | maxspxtr | green | 2026-11-06 | 2026-11-06 | 7a50980 (PR #14) | `bun test --cwd cre` 54 (W2 27: severity ladders, Open-Meteo parsing, calendar window and labels, forced labelling, expiry blocks, handlers with HTTP and EVM mocks, verifier); dry runs: weather 0 (all calm), calendar 3; `--broadcast` 3 of 3 `DemandSignal` landed and matched (Diwali in 2 days for Mumbai and Pune, Valentine's forced); logs in `cre/logs/`. Base Sepolia 5.0 blocks/s confirmed. D-13, D-14, D-72. Open: browser comparison of the forecast not recorded, review D-72; 4.5 must accept the director's `forceSignals` shape |
| S1 4.4 | W3, rulings | maxspxtr | todo |  |  |  | Set aside by maxspxtr on 2026-11-06 ("leave this milestone and go to next") after planning: evidence from S2 `/api/disputes/:id/evidence`, vision settings from the same `.env` as S2's gateway (via CRE secrets), D-17 bands to be settled at integration. The 4.5 bridge's W3 path is built and tested with a fake `cre`; its real run waits for this step |
| S1 4.5 | CRE bridge | maxspxtr | tests green, open | 2026-11-06 |  | 9bddf9a (PR #15) | keeper 111 (bridge 24 with a fake `cre`); cre 59. Real runs: timers (W1 FX 5, W1 reference 5 skipped with the service off, W2 weather 0, W2 calendar 3) and the director's forced storm by `POST /run`; on-chain FX 5 of 5, signals 4 of 4. Found and fixed: shared-key nonce clash, 97-char `--config` limit, online login check blip, unreachable source aborting a run (D-73, D-74, ICR-006). Open: dispute-triggered real run waits for S1 4.4; review D-73, D-74 |
| S1 5.1 | Hardening and sponsor deliverables | maxspxtr | tests green, open | 2026-11-06 |  | uncommitted | Invariant suite on real CCA lots (held = balance, tokens conserved, accounting, no currency stuck after all windows; 48 runs x 40 calls + a fixed path through every action); gas report and snapshot saved; `contracts/README.md` with 13 exact CCA v2.1.0 links; `FEEDBACK.md` draft; `cre/README.md`. Slither not installed (optional). Open: team notes for FEEDBACK.md, README review, cross-stream 2-minute CCA lookup check; Stream 1 complete needs S1 4.4 |
| S2 0.1 | Service skeletons, adapters, fixtures and doctor |  | todo |  |  |  |  |
| S2 1.1 | AI gateway |  | todo |  |  |  |  |
| S2 1.2 | Listing, grading, metadata, evidence |  | todo |  |  |  |  |
| S2 2.1 | Arkiv data layer and ledger writer |  | todo |  |  |  |  |
| S2 3.1 | Agent runtime core |  | todo |  |  |  |  |
| S2 4.1 | Relay |  | todo |  |  |  |  |
| S2 5.1 | LLM strategies, personas, reasons, evals |  | todo |  |  |  |  |
| S2 5.2 | Sector agents and handover behaviour |  | todo |  |  |  |  |
| S2 5.3 | Signals, references, seller advice |  | todo |  |  |  |  |
| S2 6.1 | Handover and no-show API, walk-in, STT, calendar |  | todo |  |  |  |  |
| S2 6.2 | Scenario director, load test, recorded day |  | todo |  |  |  |  |
| S2 7.1 | Hardening and Arkiv deliverables |  | todo |  |  |  |  |
| S2 8.1 | 0G verifiable grading |  | todo |  |  |  |  |
| S2 8.2 | ENS agent names |  | todo |  |  |  |  |
| S2 8.3 | World human checkpoint |  | todo |  |  |  |  |
| S2 8.4 | Hedera x402 market intel |  | todo |  |  |  |  |
| S2 8.5 | Swarm bonus (optional) |  | todo |  |  |  |  |
| S3 0.1 | App scaffold, routing, relay client, mocks, test hooks |  | todo |  |  |  |  |
| S3 1.1 | Town map in Tiled |  | todo |  |  |  |  |
| S3 1.2 | Agents in the town |  | todo |  |  |  |  |
| S3 1.3 | Market visuals, status and trust effects |  | todo |  |  |  |  |
| S3 1.4 | HUD, world clock, timeline, panels |  | todo |  |  |  |  |
| S3 2.1 | Seller chat (`/sell`) |  | todo |  |  |  |  |
| S3 2.2 | QR handover (`/scan` and show code) |  | todo |  |  |  |  |
| S3 3.1 | Buyer console (`/buy`) |  | todo |  |  |  |  |
| S3 3.2 | QR walk-in (`/walkin`) |  | todo |  |  |  |  |
| S3 4.1 | Price weather and board (`/board`) |  | todo |  |  |  |  |
| S3 5.1 | Polish, performance, demo mode, control |  | todo |  |  |  |  |
| S3 5.2 | Demo assets |  | todo |  |  |  |  |
