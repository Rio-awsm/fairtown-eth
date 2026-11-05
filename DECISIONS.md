# Decisions

Open questions D-02 to D-27 come from `03_00_START_HERE.md`. Add rows; never delete or rewrite old ones. "Default" is the guide's proposal; a decision is made only when "Chosen" is filled.

| ID | Question | Needed by | Default | Chosen | By | When |
| --- | --- | --- | --- | --- | --- | --- |
| D-02 | Demo chain | S1 0.1 | Base Sepolia | Base Sepolia (84532) | maxspxtr | 2026-11-06 |
| D-03 | Settlement assets | S1 1.1 | `tUSD`, `tEUR`, one Circle USDC proof lot | Default: `tUSD`, `tEUR`, one Circle USDC proof lot | maxspxtr | 2026-11-06 |
| D-04 | CCA deployment | S1 1.2 | Own factory v2.1.0, zero fee controller | Own `ContinuousClearingAuctionFactory` v2.1.0, `_protocolFeeController = address(0)` | maxspxtr | 2026-11-06 |
| D-05 | Seller wallets | S2 3.1 | Server-held demo keys, disclosed |  |  |  |
| D-06 | Live scenes | S2 5.2 | Bergen, Dallas, GPU, Diwali |  |  |  |
| D-07 | AI per role | S2 1.1 | Local bidding; 0G vision if verified, else cloud |  |  |  |
| D-08 | Speech | S3 2.1 | Text first, English browser speech |  |  |  |
| D-09 | Fee and advance tiers | S1 1.3 | 1%, new 50%, proven 90%, truck 10% | Default: 1%, new 50%, proven 90%, truck 10% | maxspxtr | 2026-11-06 |
| D-10 | Arkiv | S2 2.1 | **Closed:** Rabdi, SDK 1.0.x | Rabdi, SDK 1.0.x | Planning docs | 2026-11-05 |
| D-11 | REST framework | S2 0.1 | Fastify |  |  |  |
| D-12 | Durations and pickup windows | S1 1.2 | Source of truth section 14 | SoT 14 table: auction/pickup blocks fish 45/300, flowers 60/300, produce 90/450, truck 30/300, storage 30/150, compute 30/60; contest 60, report 300. Per lot via `LotSpec`, not constants | maxspxtr | 2026-11-06 |
| D-13 | Weather | S1 4.3 | Open-Meteo |  |  |  |
| D-14 | Calendar | S1 4.3, S2 6.1 | Static JSON by market |  |  |  |
| D-15 | Checkpoint cadence | S1 2.1 | Every 2 blocks while an auction has bids |  |  |  |
| D-16 | W1 pairs | S1 4.2 | cod@bergen, tomato@lagos, marigold@mumbai, gpu_hour@any_dc, truck_capacity@dallas |  |  |  |
| D-17 | Refund bands, of held share | S1 4.4 | Same grade 0%, one lower 25%, two lower 50%, unfit or no-show upheld 100% |  |  |  |
| D-18 | Agent counts | S2 0.1 | 6 sellers, 12 buyers, 4 trucks, 2 cold stores, 2 societies, 1 compute provider |  |  |  |
| D-19 | LLM budget | S2 1.1 | Concurrency 4, events only, rule fallback after 4s |  |  |  |
| D-20 | Photo storage | S2 1.2 | Local disk, hash on Arkiv |  |  |  |
| D-21 | Styling | S3 0.1 | Tailwind |  |  |  |
| D-22 | Charts | S3 0.1 | uPlot |  |  |  |
| D-23 | Art | S3 1.1 | Kenney, Ninja Adventure |  |  |  |
| D-24 | Public URL | S3 2.2 | **HTTPS tunnel required**, because camera access needs a secure page. Own hotspot |  |  |  |
| D-25 | Integration captain | C 0.1 | S1 CRE + keeper lead |  |  |  |
| D-26 | Proven threshold and seeding | S1 1.3 | 3 clean lots; operator marks seeded sellers, disclosed | Default: proven = 3 clean lots and no open no-show, or operator-marked (disclosed). A finalized no-show resets clean lots and clears the mark | maxspxtr | 2026-11-06 |
| D-27 | Circle USDC proof lot | C 3.2 | Yes |  |  |  |
| D-28 | Commit message format | C 0.1 | Guide: `s2-4.1: msg` | `type(step): msg`, e.g. `feat(c-0.1): shared units` | Rio-awsm | 2026-11-05 |
| D-29 | pnpm version | C 0.1 | Contract: 9.x | 9.15.9 pinned via `packageManager` | Rio-awsm | 2026-11-05 |
| D-30 | Copy planning docs into specs/ | C 0.1 | C 0.1: all docs in specs/ | Not copied; docs read from the fairtown-docs folder | Rio-awsm | 2026-11-05 |
| D-31 | Toolchain versions | C 0.1 | Contract section 2 | TypeScript 5.9 (typescript-eslint supports <6.1), Vitest 4.1 (Vitest 5 needs Node 22.12), zod 4 (AI SDK 7 peer `^3.25.76 \|\| ^4.1.8`) | Proposed by Claude in the C 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-32 | `role` value on the wire (contract 12.2) | C 0.1 | Undefined | ROLES key string, e.g. `"BUYER"`; the number stays onchain | Proposed by Claude in the C 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-33 | Who commits | C 0.1 | | Only people commit, tag and push; Claude never does | Rio-awsm | 2026-11-06 |
| D-34 | `.env` loading in the doctor | C 0.1 | Plan: dotenv + dotenv-expand | Node's built-in `util.parseEnv` plus a tested `${VAR}` expander. dotenv-expand jumped from 13.0.0 to 1000.0.0 on 2026-07-29, and the doctor reads private keys | Claude during C 0.1, needs review | 2026-11-06 |
| D-35 | How to run the doctor | C 0.1 | Contract 14: `pnpm doctor` | `pnpm run doctor`, because `pnpm doctor` is a pnpm built-in that shadows the script and exits 0 silently | Claude during C 0.1, needs team ack (possible ICR) | 2026-11-06 |
| D-36 | Optimizer runs (S1) | S1 0.1 | Guide: 200 | 200 for our contracts; CCA's `via_ir` profile at 11111 runs kept for `ContinuousClearingAuctionFactory.sol`, as in CCA's own `foundry.toml` | maxspxtr | 2026-11-06 |
| D-37 | Permit2, OZ, forge-std source (S1) | S1 0.1 | Guide: separate submodules | Remap to CCA v2.1.0's pinned copies (OZ 5.3.0 `e4f7021`, Permit2 `cc56ad0`, forge-std v1.9.7). One copy each, no extra submodules | maxspxtr | 2026-11-06 |
| D-38 | `AgentRegistry.setRole` event | S1 1.1 | Contract 7.2 lists only `AgentRegistered` | `setRole` re-emits `AgentRegistered(agent, newRole, name)`; role 0 revokes. No new event, so no ICR | Claude during S1 1.1, needs review | 2026-11-06 |
| D-39 | `LotToken` resolver address | S1 1.1 | Guide: escrow by settlement and resolver | Immutable constructor arg, `address(0)` until DisputeResolver (S1 4.1); zero grants nothing. v2 redeploy in 4.1 sets it | Claude during S1 1.1, needs review | 2026-11-06 |
| D-40 | `LAST_BLOCK_SHARE_BPS` default | S1 1.2 | 5000 (`.env.example`, SoT 8.2) | 7500. Spread test at 5000: 10.7%; at 7500: 4.5% (target 5%). More end weight invites sniping; mentor to confirm. ICR-002 | maxspxtr | 2026-11-06 |
| D-41 | LotFactory and settlement wiring | S1 1.2 | Unspecified | Both immutable. Deploy script predicts settlement's CREATE address for the LotFactory constructor (S1 1.4). No setter, no ICR | maxspxtr | 2026-11-06 |
| D-42 | `LotSettled.soldUnits`, `TransportNeeded.qty` | S1 1.3 | Contract: whole units | `ceil(soldTokens / 1e18)`, so 444.44 kg reports 445 and a truck is never under-booked. Exact tokens in `heldOf` | maxspxtr | 2026-11-06 |
| D-43 | `reclaimUnsold` | S1 1.3 | Unspecified | Burns the unsold tokens and closes them to relisting; the seller keeps the goods | maxspxtr | 2026-11-06 |
| D-44 | When `LotPaidInFull` fires | S1 1.3 | Contract 7.5: held fully released (and the carrier's) | Only when every held unit went to the seller (no refund on the lot), and the truck lot is also complete and clean if a carrier was assigned. Refunded lots end at `refunded` | Claude during S1 1.3, needs review | 2026-11-06 |
| D-45 | Lot status after sale | S1 1.3 | Contract 7.4: detailed status in settlement views | `MarketSettlement.statusOf(lotId)` (LOT_STATUS index). `LotFactory.Lot.status` stays OPEN. No ICR | maxspxtr | 2026-11-06 |
| D-46 | Held-share rounding and dust | S1 1.3 | Guide: `held * tokenAmount / soldTokens`, last release takes dust | Pro-rata on what is still outstanding (`heldRemaining * tokens / outstanding`); tokens below `TOKEN_DUST` = 1e12 (CCA round-down) count as done, and the remainder goes to the seller | Claude during S1 1.3, needs review | 2026-11-06 |
| D-47 | Late handover and the report window | S1 1.3 | Unspecified | A signed handover still works after the pickup deadline until `releaseExpired` runs (the seller agreed by signing). `releaseExpired` counts silence as a clean lot (SoT 8.6: Sold to PickedUp) | Claude during S1 1.3, needs review | 2026-11-06 |
| D-48 | SignalOracle and DisputeResolver in v1 | S1 1.4 | Built in S1 4.1 | Reverting stubs (`src/oracles/StubOracles.sol`) so the deployment file has valid addresses; settlement and LotFactory wired with resolver = 0 | maxspxtr | 2026-11-06 |
| D-49 | Smoke wallets | S1 1.4 | Unspecified | `AGENT_MNEMONIC` indexes 90 (seller), 91, 92 (buyers); deployer tops up gas on Base Sepolia only when low; anvil sets balances locally | maxspxtr | 2026-11-06 |
| D-50 | Block-denominated windows (amends D-12) | S1 1.4 | SoT 14 at ~2 s blocks | Base Sepolia and Base mainnet measured at ~5 blocks/s (200 ms). All values x10 to keep the intended wall-clock times: auction fish 450, flowers 600, produce 900, truck/storage/compute 300; pickup fish 3000, flowers 3000, produce 4500, truck 3000, storage 1500, compute 600; contest 600; report 3000. ICR-003. **S2 owns the auction durations** | maxspxtr | 2026-11-06 |
| D-51 | Running forge with the repo `.env` | S1 1.4 | Unspecified | `scripts/with-env.ts`: loads `.env` with the reviewed loader, runs a command in a chosen folder, and redacts RPC URLs, keys, the mnemonic and the Etherscan key from all output. Deploy scripts run forge from `contracts/` through it | Claude during S1 1.4, needs review | 2026-11-06 |
| D-52 | `@wagmi/cli` version | S1 1.4 | Contract 2: latest 2.x | Pinned exactly at 2.10.0; 2.10.1 was 4 days old (same caution as D-34) | Claude during S1 1.4, needs review | 2026-11-06 |
| D-53 | Operator wallet | S1 1.4 | Unspecified | Separate `OPERATOR_PRIVATE_KEY` gets OPERATOR_ROLE on tokens, registry, factory and settlement; the deployer keeps DEFAULT_ADMIN_ROLE | maxspxtr | 2026-11-06 |
