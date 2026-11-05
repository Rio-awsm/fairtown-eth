# Stream 3 notes

## 2026-11-06, S3 0.1

**Versions held back for the Node 22.10+ floor (D-36).**
- Vite 7 and 8, `@vitejs/plugin-react` 6 and MSW 3 need Node 22.12+. React Router 8 needs 22.22+.
- jsdom 30 and 31 need `^24.15.0`, which rejects Node 24.14.1 (this laptop). jsdom 27 to 29 need 22.12+.
- Using Vite 6.4.5, plugin-react 5.2, MSW 2.15 (the guide says MSW 2), React Router 7.18.5, jsdom 26.1.

**`@playwright/test` 1.65.0 does not install.**
- Published 2026-11-05 18:30 UTC, but it depends on `playwright-core@1.65.0`, which is not on npm (latest 1.64.1). pnpm fails with `ERR_PNPM_NO_MATCHING_VERSION`.
- Workaround: `~1.64.1`.

**Template changes.**
- Dropped `log.js` from the dev and build scripts: it sends a GET to gryzor.co on every run.
- `base: "/"` instead of `"./"`, so deep routes like `/town` resolve assets after a refresh.
- `envDir` is the repo root, so `VITE_*` comes from the same `.env` as every service.
- EventBus is a small typed emitter, not `Phaser.Events.EventEmitter`, so the store and phone pages never import Phaser.

**Shared package.**
- Import subpaths only. The root `index.ts` re-exports `addresses.ts`, which dynamically imports `node:fs`.
- `shared/test/samples.ts` is not exported, so `src/test/samples.ts` keeps its own typed sample map.

**Testing.**
- Vitest runs without globals, so Testing Library's auto-cleanup does not register. `src/test/setup.ts` calls `cleanup()` after each test.

**Lint.**
- The root `eslint.config.js` only matches `**/*.ts`, so `.tsx` files are not linted. This needs a combine-owned change.

**Prettier rewrites generated files.**
- `prettier --write apps/web` reformats `public/mockServiceWorker.js` (MSW-generated) and `dist/`. The root `.prettierignore` is combine-owned; it should list `apps/web/public/mockServiceWorker.js` and `**/dist/`. Until then, format with `prettier --write apps/web/src apps/web/e2e apps/web/scripts apps/web/*.ts`, and regenerate the worker with `pnpm exec msw init public --save`.

**Contract 11 gaps in `@fairtown/shared/api` (possible minor ICR for S2).**
- `GET /api/agents` has no list schema. The web client uses `z.array(AgentView)`.
- `GET /api/lots/meta/:draftId` has no schema. The web client accepts any JSON.

**zod 4.6.7 build warnings.**
- Rollup warns `INVALID_ANNOTATION` for two `@__PURE__` comments in `zod/v4/core/util.js` and `regexes.js`. It drops the comments; output is unaffected. `vite.config.ts` filters that code for zod files only.

**Root lint warnings on generated files.**
- `pnpm lint` passes with 2 warnings: "Unused eslint-disable directive" in `public/mockServiceWorker.js` (MSW-generated, must not be edited) and its copy in `dist-e2e/`. The root ESLint ignore list is combine-owned; it should add `apps/web/public/mockServiceWorker.js` and `apps/web/dist-e2e/`.

**Bundle size for phones.**
- The main chunk is about 504 kB (154 kB gzip). viem comes in through `@fairtown/shared/keys` (`stringToHex`) and `/units` (`parseUnits`). Worth trimming before S3 2.1 tests `/sell` on a phone.

## 2026-11-06, S3 1.1

**Rules for `public/assets/maps/town.tmj` (checked by `src/game/map/town-map.test.ts`).**
- 60 × 34 tiles of 16 px; the scene zooms to fit 1920 × 1080 (2× for this size).
- Tilesets **embedded** (Phaser cannot load external `.tsx`), one image each, images in `public/assets/tiles/`, each credited in `CREDITS.md`.
- Tile Layer Format **CSV** (Phaser cannot read zstd; any compression is rejected).
- Tile layers `ground`, `water`, `roads`, `buildings`, `decor`, `collision` (any tile on `collision` blocks). Object layer `anchors` with Point objects: `<building>.entry`, `.label`, `.stall_1..6`, `.queue_1..8` for the 7 market buildings, `town_gate.spawn`, `road_1..n`.
- `pnpm -F web map:stub` rewrites the generated stub map. It overwrites `town.tmj`, so never run it once the hand-built map is in.

**Screenshot baseline.**
- `e2e/town-map.spec.ts-snapshots/town-map-dev-darwin.png` is the stub map, rendered on macOS. When the Tiled map lands, refresh it with `pnpm -F web exec playwright test e2e/town-map.spec.ts --update-snapshots` and check the image. Other platforms create their own `-linux` baseline on first run.

**Playwright cannot `page.route` requests made by MSW's service worker.**
- With `VITE_API_URL=mock`, the MSW worker controls the page and fetches unhandled requests itself, so `page.route("**/town.tmj")` never fires. `page.context().route(...)` sees service worker traffic in Chromium.

**Broken map.**
- If `town.tmj` is missing or invalid, the scene logs the problems, draws them in red and uses the stub layout, so the replay and demo keep running. `__TOWN__.map` reports `status: "error"` with the problem list.

## 2026-11-06, S3 1.2

**Who can walk where.**
- People: any tile on `collision`, `water` or `buildings` blocks, so a forgotten collision tile under a building cannot let agents through. Trucks: `roads` tiles only.
- Pathing is easystar 0.4.4 in sync mode, 4 directions (sprites face 4 ways). The 60 × 34 grid is small enough to path on the main thread.
- Agents stand on tile centres. Queue anchors in the Tiled map should sit on open tiles; one on a blocked tile snaps to the nearest open one.

**Queues and pool.**
- One agent per queue spot, one spot per agent. A full building sends the agent to its entry, never onto a taken spot.
- At most 80 agent sprites. Agent 81 recycles the least recently active non-human; walk-ins are never recycled.

**Persona sprites.**
- Placeholders until sheets land: a role-coloured disc with a facing notch. To add one, put `<sprite>.png` (16 px frames, rows down, left, right, up, 4 frames each) in `public/assets/sprites/`, list its name in `sprites.json`, and credit it in `CREDITS.md`. The `sprite` value comes from `agent.spawned`.

## Open questions

- Should S2 add `AgentList` and `LotMeta` schemas to `@fairtown/shared/api` (minor ICR)?
