# Combine and doctor notes

## 2026-11-06, C 0.1

**`pnpm doctor` runs pnpm's built-in, not ours.**
- Expected: `pnpm doctor` (contract section 14, guides) runs `scripts/doctor.ts`.
- Actual: pnpm 9 has a built-in `doctor` command that takes priority over package scripts. It printed nothing and exited 0, which looks like a pass. The nested `pnpm -F scripts doctor` hit the same built-in.
- Workaround: `pnpm run doctor` at the root, and the root script calls `pnpm -F scripts run doctor`. Documented in README and CLAUDE.md. Contract section 14 and the guides still say `pnpm doctor`, so an ICR or a team note is needed.

**dotenv-expand jumped to 1000.0.0.**
- npm shows `dotenv-expand` 13.0.0 (2026-04-17), then 1000.0.0 (2026-07-29) as `latest`, same maintainer.
- The doctor reads `.env` with private keys, so the plan's dotenv plus dotenv-expand was replaced by Node's built-in `util.parseEnv` and a tested `${VAR}` expander (`scripts/doctor/env.ts`). D-34.
- Node's `--env-file` and `parseEnv` do not expand `${VAR}`. Every service that loads `.env.example`-style files needs expansion, or values like `VISION_BASE_URL=${LLM_BASE_URL}` arrive as literal text.

**`pnpm test:all` needs Foundry and Bun.**
- `forge test --root contracts` fails with `forge: command not found` until S1 0.1 installs Foundry and creates `contracts/`. `bun test --cwd cre` has the same issue until `cre/` exists.

**Tooling versions held back.**
- TypeScript 7.0.2 is current, but typescript-eslint 8.72.1 supports `<6.1.0`. Using 5.9.3.
- Vitest 5.x needs Node 22.12; the contract says 22.10+. Using 4.1.12.
- pnpm 10 on a laptop is fine: pnpm 9.7+ reads `packageManager` and switches to 9.15.9 itself.

## Open questions

- Should contract section 14 rename the doctor script, or keep `doctor` and say `pnpm run doctor`?
- `CLAUDE.md` line 1 points at `specs/03_00_START_HERE.md`, which is not in the repo (D-30).
