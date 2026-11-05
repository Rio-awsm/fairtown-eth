# Stream 2 notes

## 2026-11-06, S2 0.1

**`@ai-sdk/openai-compatible` version line.**
- Contract section 2 says "matching 7.x line". npm has `ai` 7.0.163 and `@ai-sdk/openai-compatible` 3.0.85; both depend on `@ai-sdk/provider` 4.0.36, so 3.x is the matching line. Use 3.x in S2 1.1.

**Context7 gaps.**
- Arkiv SDK is not indexed in Context7. Use docs.arkiv.network and the official skills from github.com/Arkiv-Network/skills.
- Context7 lists AI SDK docs only up to v6; check v7 APIs against installed type declarations.

**pnpm passes `--` through to scripts.**
- `pnpm -F relay start -- --replay x` delivers a literal `--` to the script, which `parseArgs` treats as end of options. The relay drops a leading `--`. `pnpm -F relay start --replay x` also works.

**Relative paths under `pnpm -F`.**
- Scripts run in the package folder. The relay resolves `--replay` against `INIT_CWD` so paths from the repo root work.

**FakeChain is not the CCA.**
- Clearing is computed on the whole book at once, not block by block with supply release (cumulative MPS). Good enough for mocks; S2 3.1 and 4.1 anvil tests cover the real auction.

## Open questions

- ICR-001 needs S3's ack.
- `TransportNeeded.readyByBlock` is not defined in the contract. FakeChain and fixtures use `pickupDeadline`.

## 2026-11-06, S2 1.1

**AI SDK v7 changes used.**
- Image parts are `{ type: "file", mediaType, data }`; `{ type: "image" }` is deprecated in v7.
- `createOpenAICompatible` has `transformRequestBody`, used to merge `VISION_EXTRA_BODY`. The `fetch` wrapper only captures `x_0g_trace` and `ZG-Res-Key`.
- `generateText` sends the system prompt as the first message; tests must look up the user message.

**LiteLLM gateway.**
- Serves both `/models` and `/v1/models`. The gateway adds `/v1` when `LLM_BASE_URL` lacks it.
- A typo in a model name returns HTTP 401 "key not allowed to access model", not 404.

## 2026-11-06, S2 1.2

**Photo reuse uses exact SHA-256, not a perceptual hash.** The guide asks for pHash. Decoding images needs a native dependency (sharp) or a slow pure-JS decoder, so a re-encoded or cropped copy is not caught yet. Revisit if time allows.

**References are illustrative.** Only cod@bergen has a named source to fill in (Rafisklaget minimum price); the value 8.30 EUR is the scene number. Every other row is marked illustrative. Replace before the demo or keep the label visible.

**Security hook false positive.** The security-guidance plugin blocks file writes containing `RegExp.prototype.exec` (it pattern-matches `exec(`). Use `String.prototype.match` instead.

**LotDraft has no field for photo checks.** Photo flags travel as `gradeReport.defects` entries prefixed "Photo check:" and in lot metadata `photoChecks`. A minor ICR could add a field.

**Live golden run.** 19 of 20 messages through `gemini-3.5-flash-lite` before the home-place default; m10 ("about half a tonne of roses") had no place. The rule parser alone reads all 18 non-hard messages.

## 2026-11-06, S2 2.1

**Writer owns everything for now.** Agents have no wallets until S2 3.1, so `LiveArkivStore` falls back to the writer key for any owner without a signer and counts it in `fallbacks`. Walk-in bids always go through the writer (they have no Arkiv funds).

**Bid price on Arkiv is the on-chain price.** `bid.maxPerUnit` comes from `BidSubmitted.priceQ96`, which is the bid rounded up to the auction tick, so a 9.10 bid shows about 9.15.

**Live end-to-end check.** Agents service with `ARKIV_MODE=live`: listing lot 1 wrote a `fairtown.v1.lot` entity (`0xd78bd814404cf7c0c0dd39c37ebdf3f676b02a753748c2ecd53a313f7c251c6f`) and patched it to `unsold` when the 5-block auction closed with no bids.

## 2026-11-06, S2 3.1

**FakeChain only for now.** The guide's green light needs anvil integration tests, which need S1's deployed contracts (`deployments/anvil.json`, S1 1.4). `ViemChain` and the anvil suite come in when S1 publishes, during C 1.1. Until then S2 3.1 stays open on that item.

**No-shows count per buyer.** If two buyers report the same seller, FakeChain records two no-shows (one per finalized report). Matches contract 7.5 ("a finalized no-show increments noShows").

**Live smoke.** Relay and agents running together: Ingrid listed 600 kg cod by REST; Hanse, Fjord and Oslo bid by rules (Oslo passed at its 8.00 max); the lot sold at 8.40 with 5 bids; the relay got 19 `agent.intent` envelopes and 27 agents.

**Arkiv owner fallback.** Agent wallets are not funded on Rabdi yet, so in `ARKIV_MODE=live` the writer still writes their entities. Run `pnpm -F agents fund:arkiv` to fund them, then pass the wallets as Arkiv signers (S2 3.1 follow-up).
