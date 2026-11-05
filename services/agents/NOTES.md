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
