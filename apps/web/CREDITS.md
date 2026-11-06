# Web app credits

## Code

| What | Source | Licence | Used for |
| --- | --- | --- | --- |
| Phaser React TypeScript template | [phaserjs/template-react-ts](https://github.com/phaserjs/template-react-ts) at `c726597`, Copyright (c) 2025 Phaser Studio Inc | MIT | Shape of `src/game/PhaserGame.tsx`, `src/game/main.ts` and `src/main.tsx` |

Not taken from the template: its scenes, its art (`bg.png`, `logo.png`, `star.png`), `log.js` (sends build telemetry to gryzor.co) and the `phasermsg` plugin.

## Art and sound

| File | Source | Licence | Used for |
| --- | --- | --- | --- |
| Coin, gavel, rain and bell sounds | Synthesised in the browser with Web Audio by `src/sound/sfx.ts`, own work; no sound files | CC0 | Town sound (S3 5.1) |
| `public/assets/tiles/fairtown-town.png` | Painted by `src/game/art/tiles.ts`, written by `scripts/make-stub-map.ts`; own work | CC0 | Ground, water, shore, road and plank tiles of the generated `town.tmj` |
| Buildings, people, trees, lamps, boat, gate, stalls, goods icons, truck, coins, clouds, glows | Painted in code by `src/game/art/` (`buildings.ts`, `people.ts`, `props.ts`); own work, original designs, no external art | CC0 | Every sprite in the town and the character cards on /sell, /buy, /walkin |
| Grass page background and the Fairtown house mark | Hand-written SVG in `src/index.css` and `src/hud/TownMark.tsx`; own work | CC0 | Page chrome |

Packs for a hand-built map (D-23: Kenney Tiny Town, Ninja Adventure) get one row each if added.

## Fonts

| Font | Source | Licence | Used for |
| --- | --- | --- | --- |
| Jersey 10 | [@fontsource/jersey-10](https://fontsource.org/fonts/jersey-10), Copyright 2023 The Soft Type Project Authors | SIL Open Font License 1.1 | Display: headings, buttons, badges, town signs and labels |
| Atkinson Hyperlegible | [@fontsource/atkinson-hyperlegible](https://fontsource.org/fonts/atkinson-hyperlegible), Copyright 2020 Braille Institute of America | SIL Open Font License 1.1 | Body and form text |

Both are self-hosted from npm; nothing is fetched from a font CDN.
