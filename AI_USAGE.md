# AI usage

Fairtown is built with Claude Code. Each row says what AI produced and what people did, with a link to the prompt log in `prompts/`. Planning docs written before kickoff are disclosed separately and labelled pre-kickoff.

## Combine

| Path | How AI was used | What people did | Prompt log |
| --- | --- | --- | --- |
| Root config (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint, Prettier, `.gitignore`, `.gitattributes`) | Generated from contract sections 1, 2 and 14 and the C 0.1 plan | Chose pnpm 9.15.9 pin and commit format; reviewed and committed | [C 0.1](prompts/combine/C-0.1.md) |
| `packages/shared/` | Source and tests written by Claude from contract sections 5, 6, 8, 9, 11 and 12, test first | Approved the plan, including D-31 and D-32. Rio-awsm reviewed `splitPayout` and `handover.ts` line by line | [C 0.1](prompts/combine/C-0.1.md) |
| `scripts/` (doctor, pending stub, NOTES.md) | Written by Claude, test first; replaced dotenv with a built-in parser (D-34); found the `pnpm doctor` built-in clash | Ran manual doctor checks on every machine | [C 0.1](prompts/combine/C-0.1.md) |
| `.env.example`, `DECISIONS.md`, `MILESTONES.md` | Extracted by script from contract section 4, START_HERE and the four guides | Answered D-28, D-29, D-30, D-33; removed D-00 and D-01 | [C 0.1](prompts/combine/C-0.1.md) |
| `AI_USAGE.md`, `README.md`, `LICENSE`, `CREDITS.md`, `prompts/combine/C-0.1.md` | Written by Claude | Answered MILESTONE_SYNC questions | [C 0.1](prompts/combine/C-0.1.md) |
| `CLAUDE.md` | Claude added four lines (commit format, catalog, `pnpm run doctor`, never commit) | Wrote the original rules; edited the last line | [C 0.1](prompts/combine/C-0.1.md) |
| `docs/plans/2026-11-05-c-0.1-foundation.md` | Plan written by Claude | Answered three design questions, approved with "start" | [C 0.1](prompts/combine/C-0.1.md) |

## Stream 1 (Chain)

| Path | How AI was used | What people did | Prompt log |
| --- | --- | --- | --- |
| `contracts/` (foundry.toml, remappings, Smoke and ForkSmoke tests, CcaArtifacts, NOTES, README, CLAUDE.md), CCA v2.1.0 submodule | Written by Claude; CCA config and pins read from the v2.1.0 source; found the SSH submodule URL, the forge rollback and the factory's 362 B size margin | Installed Foundry, Bun and pnpm; filled and funded `.env`; chose D-02, D-04, D-36, D-37 | [S1 0.1](prompts/stream-1/S1-0.1.md) |
| `scripts/doctor/checks/s1.ts`, `scripts/chain-fork.ts` and tests, `scripts/doctor.ts`, `package.json` scripts | Written by Claude, with failure-path and no-secret-leak tests | Chose the doctor rows for 0.1; waived the line-by-line key review | [S1 0.1](prompts/stream-1/S1-0.1.md) |
| `contracts/src/` (LotFactory roles and parents, MarketSettlement relists and carriers, Keys), `contracts/test/integration/MarketExtensions.t.sol`, `services/keeper/src/deadlines.ts` | Written by Claude; found the tick-rounding relist loss (D-63) and closed the 2.1 contract gaps | Chose the minimum relist floor (D-60); approved the plan | [S1 3.1](prompts/stream-1/S1-3.1.md) |
| `contracts/src/oracles/` (ReceiverBase, SignalOracle, DisputeResolver), `resolveRuling`, Deploy v2, `Rulings.t.sol`, `SignalOracle.t.sol`, keeper dispute expiry, ICR-005 | Written by Claude from the CRE consumer-contract docs (Context7); deployed v2 to anvil and Base Sepolia after approval | Chose the stale guard, ruling timeout, no-show rule and deploy order (D-64 to D-66); committed and approved the Base Sepolia deploy; posted "S1 v2 deployed" | [S1 4.1](prompts/stream-1/S1-4.1.md) |

## Stream 2 (Brains)

| Path | How AI was used | What people did | Prompt log |
| --- | --- | --- | --- |

## Stream 3 (Town)

| Path | How AI was used | What people did | Prompt log |
| --- | --- | --- | --- |
