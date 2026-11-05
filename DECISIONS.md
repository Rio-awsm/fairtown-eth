# Decisions

Open questions D-02 to D-27 come from `03_00_START_HERE.md`. Add rows; never delete or rewrite old ones. "Default" is the guide's proposal; a decision is made only when "Chosen" is filled.

| ID | Question | Needed by | Default | Chosen | By | When |
| --- | --- | --- | --- | --- | --- | --- |
| D-02 | Demo chain | S1 0.1 | Base Sepolia |  |  |  |
| D-03 | Settlement assets | S1 1.1 | `tUSD`, `tEUR`, one Circle USDC proof lot |  |  |  |
| D-04 | CCA deployment | S1 1.2 | Own factory v2.1.0, zero fee controller |  |  |  |
| D-05 | Seller wallets | S2 3.1 | Server-held demo keys, disclosed |  |  |  |
| D-06 | Live scenes | S2 5.2 | Bergen, Dallas, GPU, Diwali |  |  |  |
| D-07 | AI per role | S2 1.1 | Local bidding; 0G vision if verified, else cloud | Guide default | Rio-awsm | 2026-11-06 |
| D-08 | Speech | S3 2.1 | Text first, English browser speech |  |  |  |
| D-09 | Fee and advance tiers | S1 1.3 | 1%, new 50%, proven 90%, truck 10% |  |  |  |
| D-10 | Arkiv | S2 2.1 | **Closed:** Rabdi, SDK 1.0.x | Rabdi, SDK 1.0.x | Planning docs | 2026-11-05 |
| D-11 | REST framework | S2 0.1 | Fastify | Fastify 5.12 | Rio-awsm | 2026-11-06 |
| D-12 | Durations and pickup windows | S1 1.2 | Source of truth section 14 |  |  |  |
| D-13 | Weather | S1 4.3 | Open-Meteo |  |  |  |
| D-14 | Calendar | S1 4.3, S2 6.1 | Static JSON by market |  |  |  |
| D-15 | Checkpoint cadence | S1 2.1 | Every 2 blocks while an auction has bids |  |  |  |
| D-16 | W1 pairs | S1 4.2 | cod@bergen, tomato@lagos, marigold@mumbai, gpu_hour@any_dc, truck_capacity@dallas |  |  |  |
| D-17 | Refund bands, of held share | S1 4.4 | Same grade 0%, one lower 25%, two lower 50%, unfit or no-show upheld 100% |  |  |  |
| D-18 | Agent counts | S2 0.1 | 6 sellers, 12 buyers, 4 trucks, 2 cold stores, 2 societies, 1 compute provider | Guide default, 27 personas in `fixtures/agents.json` | Rio-awsm | 2026-11-06 |
| D-19 | LLM budget | S2 1.1 | Concurrency 4, events only, rule fallback after 4s | Guide default (gateway defaults: concurrency 4, timeout 4000 ms) | Rio-awsm | 2026-11-06 |
| D-20 | Photo storage | S2 1.2 | Local disk, hash on Arkiv | Guide default: `STORAGE_DIR/photos/<sha256>`, served at `/api/photos/:hash` | Rio-awsm | 2026-11-06 |
| D-21 | Styling | S3 0.1 | Tailwind |  |  |  |
| D-22 | Charts | S3 0.1 | uPlot |  |  |  |
| D-23 | Art | S3 1.1 | Kenney, Ninja Adventure |  |  |  |
| D-24 | Public URL | S3 2.2 | **HTTPS tunnel required**, because camera access needs a secure page. Own hotspot |  |  |  |
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
| D-36 | `ChainAdapter.submitBid` price unit | S2 0.1 | Executor passes Q96 on a tick | Adapter takes `maxPerUnit` in base units, converts to Q96 and rounds up to the tick, so an off-tick bid can't be sent | Proposed by Claude in the S2 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-37 | `ArkivStore` expiry unit | S2 0.1 | Undefined | Seconds (`expiresInSeconds`), mapped to the SDK's `ExpirationTime` in S2 2.1 | Proposed by Claude in the S2 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-38 | Agents config when a mode var is unset | S2 0.1 | Undefined | Defaults to `CHAIN_MODE=fake`, `ARKIV_MODE=memory`, `MOCK_AI=1` (guide rule 7) | Proposed by Claude in the S2 0.1 plan, approved by Rio-awsm | 2026-11-06 |
| D-39 | FakeChain clearing and auto-keeper | S2 0.1 | Undefined | Uniform clearing at the lowest price where demand fits qty; marginal tier rationed by time. FakeChain settles, assigns carriers, finalizes no-shows and releases expired held money on `mine()` | Rio-awsm (design approval) | 2026-11-06 |
| D-40 | AI provider for S2 | S2 1.1 | Local model (D-07) | Team LiteLLM gateway (OpenAI-compatible): bidder `gemini-2.5-flash-lite`, listing and vision `gemini-3.5-flash-lite`. All three pass native JSON-schema output, about 1.1 s per call | Rio-awsm | 2026-11-06 |
| D-41 | Listing parse and floor | S2 1.2 | Undefined | LLM returns words as written; code maps synonyms and converts units; deterministic rule parser as fallback; place defaults to the seller's home place. Floor = reference (or blend with median of last 10 clears) x grade factor, 10% below (15% if under 6 h), rounded down to 0.01 | Proposed by Claude, approved by Rio-awsm ("start 1.2") | 2026-11-06 |
| D-42 | Arkiv write ownership before agent wallets | S2 2.1 | Contract 10: seller, buyer and truck agents own their entities | Writer key owns every entity until S2 3.1 funds agent wallets (`pnpm -F agents fund:arkiv`). Walk-in bids always written by the writer. Writes are idempotent (dedupe query by owner and natural key before create and before a retry) | Claude, needs Rio-awsm ack | 2026-11-06 |
