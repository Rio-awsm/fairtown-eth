# Stream 3 notes

## 2026-11-06, S3 0.1

**Versions held back for the Node 22.10+ floor (D-106).**

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

## 2026-11-06, S3 1.3

**Effects.**

- Every row of the S3 1.3 table is a reducer command. New local commands (no ICR, web-only): `coinArc`, `openVault`, `signNoShow`, `inspect`, `refundBadge`, `plaque`, `setClock`; `placeStall` carries `seller`.
- `reduceEnvelope` advances the town block from each envelope's `block` (never backwards) and emits `setClock`. Countdowns are block-based (2 s per block), so screenshots are deterministic.
- `__TOWN__.effectsSeen` counts what the scene actually played, by command kind or `kind:variant` (for example `setWeather:storm`, `setStatus:paid_in_full`).
- Weather, festival lights, night tint and plaques are static on purpose; moving effects (coins, crates, vault door, magnifier, bubbles) scale with the replay speed.

**Slot manager.** `market/slots.ts` keeps finished stalls (gold, refunded, no-show) on screen until a new lot needs the slot, then removes the old one. No overlapping stalls.

**Baselines.** `e2e/effects.spec.ts-snapshots/` holds storm, Diwali and no-show, each replayed with `?speed=50&until=<id>` (dev only) and settled for 1.5 s. Refresh with `--update-snapshots` when the Tiled map or art lands.

**Readability.** Stall text is 4 px in map units (about 8 px on screen at 1920 × 1080). Fine on a laptop, small on a projector; enlarge in `?demo=1` (S3 5.1).

## 2026-11-06, S3 1.4

**HUD.** `/town` is full screen; its HUD top bar carries LIVE or REPLAY and TEST MONEY there (every other route keeps the shell header). Keys `1` to `7`: Fish Dock, Freight Yard, Flower Hall, Harvest Hall, Cold Vault, Neighbourhood Pool, Compute Yard. `Esc` closes the panel.

**World clock** reads the time of the latest envelope, so replays show the recorded time (Bergen 05:00 at the start of the day). With no envelope yet it uses the wall clock.

**Explorer links.** `VITE_EXPLORER_URL`, defaulting to `https://sepolia.basescan.org` (D-02), so every tx and address links somewhere.

**Assumed API fields (S2 to confirm, possible minor ICR).**

- `GET /api/lots/:lotId` (`LotView`, loose): the grade report is read from `gradeReport` or `spec.gradeReport`, with `grade`, `confidence`, `standard`, `defects`, `tee_verified`. The Verified badge shows only for `tee_verified === true`.
- `GET /api/agents/:agentId` (`AgentView`, loose): `persona`, `currency`, `budget`, `mandate.commodities`, `mandate.maxPerUnit`.

**uPlot** loads on demand when a lot panel opens (it touches `matchMedia` at import, and keeps 52 kB out of the main bundle).

**Baselines** mask the DOM HUD (`mask: [data-hud]`), so they judge only the canvas.

## 2026-11-06, S3 2.1

**Payout preview** is the honest minimum: `splitPayout` at the floor price × qty, fee 1% (D-09, `FEE_BPS` in `src/sell/model.ts`), and the draft's `advanceBps`. Wording: "At least €2,227.50 at sale, about NOK 26,222, and the rest at handover." The "about" part uses `/api/fx` and is display only.

**Auction length** for a new listing is 150 blocks (about 5 minutes), `DURATION_BLOCKS` in `src/sell/model.ts`. Change it if S1 sets a different default (D-12).

**Camera.** In-app only (`getUserMedia`, no file input). The 4-digit lot code is shown over the preview for the seller to hold in frame, and travels with each photo as `lotCode`, with `capturedAt` and GPS when allowed. Cameras need a secure page: localhost or the HTTPS tunnel (D-24).

**Mobile e2e** runs Chromium with the iPhone 13 screen and touch, because only Chromium can fake a camera (`--use-fake-device-for-media-stream`). Real iPhone Safari stays a manual check over the tunnel.

**axe** found two real issues, both fixed: nav links overflowed onto the browser's white background on a phone (header now wraps, page background is dark), and white text on `emerald-600` buttons was below 4.5:1 (now `emerald-700`).

**Assumed API fields (S2 to confirm).** `GET /api/sellers/:sellerId`: `lots[]` with `lotId, commodity, qty, unit, status`; `payouts[]` with `lotId, kind (at_sale | at_handover | refund), amount, currency, tx`. Rows that do not match are skipped.

**Phones over the tunnel.** Vite 6 answers "Blocked request. This host is not allowed" for any host it does not know, so a phone on `https://<name>.trycloudflare.com` saw an error page. `vite.config.ts` now allows `.trycloudflare.com` for `dev` and `preview`; other hosts still get 403. Hot reload does not work through the tunnel (the page still does).

## 2026-11-06, S3 2.2

**Handover code.** `ShowCode` asks `POST /api/handover/ticket` for one buyer (D-108) and draws `qrText` as an SVG QR. It waits for `GET /api/lots/:lotId` before choosing the buyer: deciding earlier picked the single-bidder fallback before `winners` arrived (caught by a test). Expired code: "This code has expired." and a New code button.

**Scanning.** Nothing is sent on scan. `/scan` reads raw ticket JSON or the fallback link (`/scan?code=`), then checks expiry against the relay block, that the lot is `sold` or `truck_booked`, and that the receiver is the ticket's buyer or the lot's assigned carrier. Only Confirm calls `POST /api/handover/confirm`.

**QR decoder.** `@yudiel/react-qr-scanner` uses zxing-wasm, which by default downloads `zxing_reader.wasm` from fastly.jsdelivr.net. `QrScanner.tsx` serves our own copy (`zxing-wasm/reader/zxing_reader.wasm?url`, 947 kB, lazy), so scanning works offline on venue Wi-Fi.

**Camera constraints.** The library's default demands at least 640 px of height, so 480p webcams and Chromium's fake camera failed with `OverconstrainedError`, and our message wrongly said "blocked". Now: ideal values only, and `cameraProblem()` says "blocked" only for a permission error.

**Two-phone e2e.** `playwright.config.ts` writes `e2e/.generated/lot12-code.y4m`, a video of the exact Lot 12 QR, and the `scan` project feeds it to Chromium's fake camera. Replays stop with `?until=<carrier.assigned for Lot 12>` so the lot is still waiting for its handover.

**Assumed API field (S2, minor ICR).** `GET /api/lots/:lotId` → `winners: [{ buyer, tokenAmount }]` (D-108).

## 2026-11-06, S3 3.1

**Buyer console.** Agents are the API list (`GET /api/agents`) merged with buyer agents seen in the town, by address. A created buyer is added to the list and its detail straight from the create response. Money: max price and budget typed in plain units, sent as base units; the budget must cover max price × quantity when a quantity is set.

**Mock API is stateful for agents** (`src/mocks/agents.ts`): create, pause and edit persist until reload, like the real service. Tests call `resetMockAgents()`.

**Fixture.** A clock jump (`block += 160`) after Lot 60 sells makes Coastal Catch's pickup deadline pass before Hanse reports the no-show, so "Seller didn't come" is reachable at `until=<that clock id>`. The effects baselines did not change.

**"Watch in town"** opens `/town?select=agent:<id>`; the Town page turns `select` into the panel selection (also `lot:<id>` and `building:<name>`).

**Assumed API fields (S2 to confirm).** `GET /api/agents/:agentId`: `currency`, `budget`, `paused`, `mandate`, `persona`; SOCIETY agents: `families: [{ name, qty }]`.

## 2026-11-06, S3 3.2

**Walk-in prices snap to ticks.** `src/walkin/model.ts`: tick = `tickFor(toQ96(floor))`; the first slider step is the smallest tick strictly above clearing (or the floor before bids); each step is one tick. It sends `maxPerUnit = fromQ96(tick)`, which the API's `ceilToTick(toQ96(…))` rounds back to exactly that tick (tested across 24 floor and price combinations, 40 steps each).

**Walk-in budget.** `POST /api/walkin` has no budget in contract 11, so the walk-in may spend up to 100.00 in the lot's currency (`DEFAULT_BUDGET`) unless the response carries `budget`. S2: add `budget` to `WalkinResponse` (minor ICR). The server's guardrails still decide.

**Session** lives in memory and `sessionStorage` (try/catch: Safari private mode throws); a reload keeps the walk-in in.

**QR overlay** on `/town` and `/board` encodes `PUBLIC_WEB_URL/walkin`. `PUBLIC_WEB_URL` reaches the browser through `envPrefix` (it is public). Unset or the `.env.example` placeholder: falls back to the page address and warns outside production. Set it to the tunnel address before a demo.

**Baselines fixed.** The HUD mask on the zero-size `[data-hud]` wrapper hid nothing, so baselines included the HUD (and its wall-clock world clock with `?relay=off`). They now hide the HUD with a style tag before each shot and judge only the canvas.

**Late scenes missed plaques.** Under load the map loads after the first reference price, and the redraw on `scene:ready` had no plaques. `commandsForState` now redraws them (test added); found by a flaky 20× effects run.

## 2026-11-06, S3 4.1

**Arkiv SDK 1.0.1 (checked in its source).** Query values are `{ type, value }`; expressions are plain trees (`kind: "comparison" | "and" | …`); `builder.toString()` is the exact wire text and needs no network; `select()` with no arguments selects every column; fetched rows hold typed values (`row.x.value`), so the live client unwraps them. Nested `and()` renders flat, without parentheses. Context7 has no Arkiv docs; docs.arkiv.network was read directly.

**One query, two modes.** Board queries are SDK expressions. Live (`VITE_ARKIV=live`) sends them to Rabdi; mock (default) evaluates the same expression on a MOCK LEDGER built from relay events by contract 10's rules (a `price` per `lot.settled`, a new `reputation` per `seller.record`). The query box always shows the SDK's own `toString()`.

**Browser key (D-109).** The read key ships to the browser. Limit its Origins on hub.arkiv.network to `http://localhost:8080` and the tunnel. Quick-tunnel addresses change on every restart, so update the Origins or use a named tunnel for the demo. With no key the SDK falls back to the public endpoint, which is heavily rate limited.

**Temporary schemas (D-110).** `src/arkiv/schemas.ts` mirrors contract 10. Types to reconcile with S2: `seller` is `str` (lowercase address) here; S2 may choose `addr`. Reputation `refundedBps` (source of truth 9.2) is not read yet.

**Price weather** groups by market, commodity and currency (haddock is never judged against cod's average). Bands ±5% / ±15% in basis points; exactly +5% is "higher", exactly −5% "lower". A building's tint follows its most recent commodity. Newest record = latest day, then highest lot id.

**New env vars (contract 4, minor ICR for combine):** `VITE_ARKIV` (`mock` | `live`, default `mock`) and `VITE_ARKIV_ACCESS_KEY` should be added to `.env.example`.

**Bundle.** `/board` loads lazily, so the Arkiv SDK never reaches the phone pages (main chunk 590 kB, not 920 kB).

## 2026-11-06, S3 5.1

**Frame rate.** `/town?stress=1` (dev only) adds 60 walking agents and 18 stalls; `__TOWN__.fps` is Phaser's smoothed `actualFps`. Headless Chromium uses software WebGL (SwiftShader) and holds about 51 to 55 fps at 1920 × 1080; the same test fell to about 32 fps while five other browsers ran in parallel, so it now runs alone in the `perf` Playwright project after all the others. Margin is thin in headless; a real GPU should sit at the display rate. Lowering agent text resolution made no measurable difference and was reverted. Manual check: full script on the projector laptop.

**Camera director** follows new stalls, sales, handovers, no-shows and walk-ins, holds 4 s, then returns home. On by default only with `?demo=1` (screenshots and click tests stay still); `D` toggles it.

**Sound** is synthesised with Web Audio (no files to license); muted by default because browsers need a click first; `M` or the top bar button; the choice is remembered (localStorage, try/catch).

**/control → /town** uses a BroadcastChannel (`fairtown-control`), so it works between windows on one computer. A phone remote would need a relay message from S2. Scenarios always go through `POST /api/director/scenario`. Replay speed changes live in mock mode only.

**Demo mode** (`?demo=1`) raises the root font size (HUD, pages) and town text 1.6×; badges stay (e2e checks `/town`, `/board`, `/sell`).

**Bundle watch.** `/control` importing `KEY_BUILDINGS` from `HudLayer` pulled the HUD and the Arkiv SDK into the main chunk (935 kB). The list now lives in `src/hud/keys.ts` (main chunk 597 kB).

## 2026-11-06, landing hero at /

`/` is a scroll-driven hero built from the pasted NORVA hero brief: its layout, motion, Inter Tight, and the brief's CloudFront clip and poster. It was first built exactly as written (iamanirbanbasak: "Exactly as written", "make it in react"), then the words were changed to Fairtown's ("change the content of this landing in accordance to fairtown"). It sits outside the app shell, with its own nav: LIVE or REPLAY (from the town store) and TEST MONEY, "How a deal works" (jumps 30% into the glide), the public board, the FAIRTOWN wordmark, "Sell a lot" and "Open the town". The three.js town and the uncommitted work before it (dark theme, deal talk, 80 × 45 map) were dropped at the user's request; `/town` is the committed pixel town again.

- **Steps.** All four deal steps have a paragraph and open in turn: 01 below p .40, 02 to .60, 03 to .80, then 04. The brief opened only two.
- **Scroll.** A 420vh track holds a sticky 100vh `<video>`. Everything except the clip is a pure function of p (`src/landing/progress.ts`, unit-tested). The clip is smoothed (`cur += (target − cur) × 0.2`) and seeks only when the video is not already seeking and is more than 1/60 s off, again on `seeked`.
- **Loader.** It fades 350 ms after the clip's first frame, or after 3.5 s at most, so a blocked CDN never traps the page. e2e blocks the CDN for every check except one, which skips itself when the CDN cannot be reached.
- **Recorder.** `?rec=1` removes the loader. A 6.5 s Web Animation (on a detached element) drives p: hold 0.55 s, glide 5.04 s, hold. It starts on the clip's first frame, or after 3.5 s. `window.__recTime(video, t)` pauses that clock, scrolls to the matching p, paints and returns the clip time.
- **Fonts.** The app's global `h1` face is the pixel font; `.landing .landing-title` resets it.
- **Clip length.** The brief says 5.04 s; the desktop file reports 4.97 s in Chromium. Clip time uses the file's own duration.

## 2026-11-06, /board in the landing's look

`/board` moved out of the pixel app shell into `SiteShell` (`src/landing/`): the landing's top bar (`SiteNav`, now shared, solid and sticky here), the night ground and Inter Tight. The board itself (`src/board/board.css`): a large title as the landing sets its headline; price weather as the page's centrepiece, with each market's band in large coloured words and its 30 days as a cyan sparkline; the query box with pill selects and cyan query text; live auctions, latest clears and seller records down a hairline rail. Small labels are white at 60%, because 46% fails 4.5:1 on night. `WalkinQr` takes `look="night"` and `TxLink` a `className` for the board; elsewhere they keep the pixel look. Sized in rem, so `?demo=1` still grows it. The other app pages are unchanged.

## 2026-11-06, D-113: the 3D town and the night skin

**Renderer.** three.js replaces Phaser for /town (`src/town3d/`). `engine.ts` is the old `scenes/Town.ts` ported command by command; the reducer, `TownCommand`s, EventBus events and `__TOWN__` are unchanged, and positions stay in map pixels (one tile = one world unit), so pathing, queues and the e2e probe read them as before. The probe gains `camera` (zoom, 1 = whole town; the view's centre in map pixels).

**Look.** Kenney's CC0 glTF models (City Kits, Car Kit, Mini Characters, Nature, Watercraft) dressed in one graphite clay: each kit's palette texture is redrawn as clay, and its pale-blue glass texels become an emissive map, so windows glow warm at one of four levels. A CC0 Poly Haven night HDRI lights glass, water and paint. Bloom (its blur at half size) and one finishing pass (tilt-shift, vignette, grain). Cyan routes along the roads into a glowing settlement hub; outskirts past the map edge fade into the fog. Sellers, drivers and walk-ins are Kenney's rigged characters walking and idling with their own animations; AI agents are glowing orbs by role. "Lit miniature", not photoreal: the models are low-poly and the realism comes from the light.

**Camera.** Mouse wheel: one step a notch towards the cursor; trackpad scroll and pinch (ctrl + wheel; Safari gesture events): smooth, then settle on a step (1, 1.5, 2, 3, 4, 6). Drag pans when zoomed in; + − 0 on the keyboard. Any of them pauses the director for 20 s.

**Labels.** Names, speech, stall cards, signs, plaques and weather are DOM chips pinned in 3D (`CSS2DRenderer`). Offsets use the `translate` property: CSS2DRenderer positions labels by `transform`, which margins do not move. Every 150 ms a declutter pass hides the less important of any two that would overlap (speech, stalls, weather and plaques, signs, name tags) and treats the HUD's windows as fixed obstacles; from far away stall cards show only price and status.

**Loading.** Commands that arrive while models load are queued and played once the city is built, before the store sends the current state; a fast replay under load used to pass its truck events before the town was ready. A model that fails to load becomes a clay box and is listed in `map:status` problems.

**Light mode.** Software WebGL (SwiftShader in headless Chromium, llvmpipe) or `?quality=low`: no bloom chain, no shadows, half-size backbuffer. On the GPU the shadow map is redrawn only when casters change. e2e runs Chromium on the GPU on macOS (`playwright.config.ts`); elsewhere it falls back to light mode.

**Pages.** Every app page sits in `SiteShell` (`src/landing/`): the landing's top bar (none on /town, whose HUD carries the same bar) and one night skin (`src/styles/night.css`). The skin is unlayered CSS, which beats Tailwind 4's layered utilities and our pixel-era component classes, so the markup and its accessible names are unchanged. The pixel people on /sell, /buy and /walkin stay for now. The town's top bar no longer lists signals as chips; they show as weather over the market and in the ticker.

## Open questions

- iamanirbanbasak: licence for the landing's clip and poster (hotlinked from the NORVA brief, unconfirmed), or a Fairtown clip to replace them.

- S2: confirm the `LotView.gradeReport` and `AgentView` fields above, or add them to `@fairtown/shared/api`.
- S2: add `winners: [{ buyer, tokenAmount }]` to `LotView` (D-108), so lots with several buyers get handover codes.
- S2: add `budget` to `WalkinResponse`, or confirm the 100.00 demo default.
- S2: publish `@fairtown/shared/arkiv` and `arkiv/queries.md`; confirm `seller` type (`str` or `addr`) in `fairtown.v1.reputation`.
- Combine: add `VITE_ARKIV` and `VITE_ARKIV_ACCESS_KEY` to `.env.example` (contract 4).
- S2: a relay message for presenter controls, if a phone remote for /control is wanted.

- Should S2 add `AgentList` and `LotMeta` schemas to `@fairtown/shared/api` (minor ICR)?
