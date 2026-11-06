import type { Hex } from "./pix"

/** The town's colours. Shared with the page chrome in src/index.css (ink, parchment, coin). */
export const P = {
  ink: "#2a1f33",
  inkSoft: "#5b4a63",
  parchment: "#f8eccb",
  parchmentDeep: "#efdcab",
  white: "#fffaea",

  grass: "#6db55a",
  grassLight: "#82c46a",
  grassDark: "#5aa04b",
  grassDeep: "#3f7d45",
  leaf: "#3e8a3f",
  leafLight: "#5fae4c",
  leafDark: "#2b5f31",
  trunk: "#7a4b2a",

  water: "#3a7bc8",
  waterDeep: "#2f68ad",
  waterLight: "#5b9be0",
  foam: "#bfe6f2",
  sand: "#e9d39a",
  sandDark: "#d4b877",

  cobble: "#cdae7e",
  cobbleLight: "#e2c896",
  cobbleDark: "#a98a5d",
  mortar: "#8f7450",

  wood: "#9c6b3f",
  woodLight: "#b9844f",
  woodDark: "#6a4024",
  stone: "#b9b1a6",
  stoneLight: "#d6d0c6",
  stoneDark: "#8f877d",
  glass: "#9fd3ee",
  glassDark: "#5d9cc4",
  lampGlow: "#ffd36e",

  coin: "#f2b33d",
  coinLight: "#ffe08a",
  coinDark: "#b07a12",
  brick: "#c6483b",
  brickDark: "#8f2f27",
  magenta: "#ff00ff",

  flowerYellow: "#f7e08a",
  flowerPink: "#f28fb0",
  flowerWhite: "#ffffff",
  flowerBlue: "#9dc3ff",
  flowerOrange: "#f59e0b",
  rose: "#e5485f",
} as const satisfies Record<string, Hex>
