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

## Stream 2 (Brains)

| Path | How AI was used | What people did | Prompt log |
| --- | --- | --- | --- |

## Stream 3 (Town)

| Path | How AI was used | What people did | Prompt log |
| --- | --- | --- | --- |
