import { P } from "./palette"

/** Town text: the pixel face, ink stroke for legibility on grass, rendered at 3× for a sharp zoom. */
export const TOWN_TEXT = {
  fontFamily: '"Jersey 10", "Atkinson Hyperlegible", sans-serif',
  color: P.white,
  stroke: P.ink,
  strokeThickness: 3,
  resolution: 3,
} as const

/** Dark text on a wooden or parchment sign. */
export const SIGN_TEXT = { ...TOWN_TEXT, color: P.ink, stroke: P.parchment, strokeThickness: 0 } as const
