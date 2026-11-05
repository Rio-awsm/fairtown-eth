# Decisions

Open questions D-02 to D-27 come from `03_00_START_HERE.md`. Add rows; never delete or rewrite old ones. "Default" is the guide's proposal; a decision is made only when "Chosen" is filled.

| ID | Question | Needed by | Default | Chosen | By | When |
| --- | --- | --- | --- | --- | --- | --- |
| D-02 | Demo chain | S1 0.1 | Base Sepolia |  |  |  |
| D-03 | Settlement assets | S1 1.1 | `tUSD`, `tEUR`, one Circle USDC proof lot |  |  |  |
| D-04 | CCA deployment | S1 1.2 | Own factory v2.1.0, zero fee controller |  |  |  |
| D-05 | Seller wallets | S2 3.1 | Server-held demo keys, disclosed |  |  |  |
| D-06 | Live scenes | S2 5.2 | Bergen, Dallas, GPU, Diwali |  |  |  |
| D-07 | AI per role | S2 1.1 | Local bidding; 0G vision if verified, else cloud |  |  |  |
| D-08 | Speech | S3 2.1 | Text first, English browser speech | Text first; browser `SpeechRecognition` in `en-US`, else record and `POST /api/stt`, else no mic | iamanirbanbasak | 2026-11-06 |
| D-09 | Fee and advance tiers | S1 1.3 | 1%, new 50%, proven 90%, truck 10% |  |  |  |
| D-10 | Arkiv | S2 2.1 | **Closed:** Rabdi, SDK 1.0.x | Rabdi, SDK 1.0.x | Planning docs | 2026-11-05 |
| D-11 | REST framework | S2 0.1 | Fastify |  |  |  |
| D-12 | Durations and pickup windows | S1 1.2 | Source of truth section 14 |  |  |  |
| D-13 | Weather | S1 4.3 | Open-Meteo |  |  |  |
| D-14 | Calendar | S1 4.3, S2 6.1 | Static JSON by market |  |  |  |
| D-15 | Checkpoint cadence | S1 2.1 | Every 2 blocks while an auction has bids |  |  |  |
| D-16 | W1 pairs | S1 4.2 | cod@bergen, tomato@lagos, marigold@mumbai, gpu_hour@any_dc, truck_capacity@dallas |  |  |  |
| D-17 | Refund bands, of held share | S1 4.4 | Same grade 0%, one lower 25%, two lower 50%, unfit or no-show upheld 100% |  |  |  |
| D-18 | Agent counts | S2 0.1 | 6 sellers, 12 buyers, 4 trucks, 2 cold stores, 2 societies, 1 compute provider |  |  |  |
| D-19 | LLM budget | S2 1.1 | Concurrency 4, events only, rule fallback after 4s |  |  |  |
| D-20 | Photo storage | S2 1.2 | Local disk, hash on Arkiv |  |  |  |
| D-21 | Styling | S3 0.1 | Tailwind | Tailwind 4.3 via `@tailwindcss/vite` | iamanirbanbasak | 2026-11-06 |
| D-22 | Charts | S3 0.1 | uPlot | uPlot, installed at S3 1.4 with the first chart | iamanirbanbasak | 2026-11-06 |
| D-23 | Art | S3 1.1 | Kenney, Ninja Adventure | Kenney Tiny Town (16 px, CC0) as the base, Ninja Adventure (CC0) for decor. A generated stub map stands in until the Tiled map lands | iamanirbanbasak | 2026-11-06 |
| D-24 | Public URL | S3 2.2 | **HTTPS tunnel required**, because camera access needs a secure page. Own hotspot | Cloudflare quick tunnel (`pnpm tunnel`); Vite allows `.trycloudflare.com` hosts | iamanirbanbasak | 2026-11-06 |
| D-25 | Integration captain | C 0.1 | S1 CRE + keeper lead |  |  |  |
| D-26 | Proven threshold and seeding | S1 1.3 | 3 clean lots; operator marks seeded sellers, disclosed |  |  |  |
| D-27 | Circle USDC proof lot | C 3.2 | Yes |  |  |  |
| D-28 | Commit message format | C 0.1 | Guide: `s2-4.1: msg` | `type(step): msg`, e.g. `feat(c-0.1): shared units` | Rio-awsm | 2026-11-05 |
| D-29 | pnpm version | C 0.1 | Contract: 9.x | 9.15.9 pinned via `packageManager` | Rio-awsm | 2026-11-05 |
| D-30 | Copy planning docs into specs/ | C 0.1 | C 0.1: all docs in specs/ | Not copied; docs read from the fairtown-docs folder | Rio-awsm | 2026-11-05 |
| D-31 | Toolchain versions | C 0.1 | Contract section 2 | TypeScript 5.9 (typescript-eslint supports <6.1), Vitest 4.1 (Vitest 5 needs Node 22.12), zod 4 (AI SDK 7 peer `^3.25.76 \|\| ^4.1.8`) | Proposed by Claude in the C 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-32 | `role` value on the wire (contract 12.2) | C 0.1 | Undefined | ROLES key string, e.g. `"BUYER"`; the number stays onchain | Proposed by Claude in the C 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-33 | Who commits | C 0.1 | | Only people commit, tag and push; Claude never does | Rio-awsm | 2026-11-06 |
| D-34 | `.env` loading in the doctor | C 0.1 | Plan: dotenv + dotenv-expand | Node's built-in `util.parseEnv` plus a tested `${VAR}` expander. dotenv-expand jumped from 13.0.0 to 1000.0.0 on 2026-07-29, and the doctor reads private keys | Claude during C 0.1, needs review | 2026-11-06 |
| D-35 | How to run the doctor | C 0.1 | Contract 14: `pnpm doctor` | `pnpm run doctor`, because `pnpm doctor` is a pnpm built-in that shadows the script and exits 0 silently | Claude during C 0.1, needs team ack (possible ICR) | 2026-11-06 |
| D-36 | Web toolchain versions | S3 0.1 | Latest | Hold back for the Node 22.10+ floor: Vite 6.4.5, `@vitejs/plugin-react` 5.2, MSW 2.15, React Router 7.18.5, jsdom 26.1. Latest Vite 7/8, plugin-react 6 and MSW 3 need Node 22.12+, React Router 8 needs 22.22+, jsdom 30/31 need `^24.15`. `@playwright/test` ~1.64.1 because 1.65.0 depends on an unpublished `playwright-core` | Proposed by Claude in the S3 0.1 plan, approved by iamanirbanbasak | 2026-11-06 |
| D-37 | Replay fixture before S2 0.1 | S3 0.1 | Contract 13: `packages/shared/fixtures/day.jsonl` | Temporary `apps/web/src/mocks/day.jsonl` (79 envelopes, every event type, one deliberate duplicate id), generated by `buildDay()` and checked against the shared `TownEnvelope`. Swap to the shared file in `apps/web/src/net/replayClient.ts` when S2 ships it | Proposed by Claude in the S3 0.1 plan, approved by iamanirbanbasak | 2026-11-06 |
| D-38 | Who a handover code is for | S3 2.2 | Undefined in contract 11 | Seller picks from `winners: [{ buyer, tokenAmount }]` on `GET /api/lots/:lotId`; until S2 adds it, only a single-bidder lot gets a code (all `soldUnits × 10^18`). Several bidders and no `winners`: no code, never a guess | Proposed by Claude in the S3 2.2 plan, approved by iamanirbanbasak ("go") | 2026-11-06 |
