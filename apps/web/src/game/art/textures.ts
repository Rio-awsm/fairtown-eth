import type { Scene } from "phaser"
import type { MarketBuilding } from "../map/anchors"
import { MARKET_BUILDINGS } from "../map/anchors"
import { paintBuilding } from "./buildings"
import { P } from "./palette"
import { PERSON, SHEET_FACINGS, lookKey, paintPerson, type PersonLook } from "./people"
import { toCanvas, type Pix } from "./pix"
import * as Props from "./props"
import { TILE, paintTileset } from "./tiles"

/** Texture keys for the painted art. */
export const ART = {
  tileset: "art:tileset",
  building: (b: MarketBuilding) => `art:building:${b}`,
  tree: (i: number) => `art:tree:${i}`,
  pine: "art:pine",
  bush: "art:bush",
  lamp: "art:lamp",
  fence: "art:fence",
  boat: "art:boat",
  gate: "art:gate",
  awning: "art:awning",
  counter: "art:counter",
  good: (name: string) => `art:good:${name}`,
  truck: "art:truck",
  crate: "art:crate",
  coin: "art:coin",
  cloud: "art:cloud",
  puff: "art:puff",
  drop: "art:drop",
  sparkle: "art:sparkle",
  glow: "art:glow",
  bulb: (i: number) => `art:bulb:${i}`,
} as const

export const TREE_KINDS = 3
export const BULB_COLOURS = [P.coin, "#f97316", "#ec4899", "#4ade80", "#38bdf8"] as const

function add(scene: Scene, key: string, pix: Pix) {
  if (scene.textures.exists(key)) return
  scene.textures.addCanvas(key, toCanvas(pix))
}

/** Paints every fixed texture once per game. Cheap: a few hundred small canvases' worth of pixels. */
export function registerArt(scene: Scene): void {
  add(scene, ART.tileset, paintTileset())
  for (const b of MARKET_BUILDINGS) add(scene, ART.building(b), paintBuilding(b))
  for (let i = 0; i < TREE_KINDS; i++) add(scene, ART.tree(i), Props.paintTree(i + 3))
  add(scene, ART.pine, Props.paintPine())
  add(scene, ART.bush, Props.paintBush())
  add(scene, ART.lamp, Props.paintLamp())
  add(scene, ART.fence, Props.paintFence())
  add(scene, ART.boat, Props.paintBoat())
  add(scene, ART.gate, Props.paintGate())
  add(scene, ART.awning, Props.paintAwning())
  add(scene, ART.counter, Props.paintCounter())
  for (const name of Object.keys(Props.GOODS)) add(scene, ART.good(name), Props.paintGood(name))
  add(scene, ART.truck, Props.paintTruck())
  add(scene, ART.crate, Props.paintCrate())
  add(scene, ART.coin, Props.paintCoin())
  add(scene, ART.cloud, Props.paintCloud())
  add(scene, ART.puff, Props.paintPuff())
  add(scene, ART.drop, Props.paintDrop())
  add(scene, ART.sparkle, Props.paintSparkle())
  add(scene, ART.glow, Props.paintGlow(32))
  BULB_COLOURS.forEach((c, i) => add(scene, ART.bulb(i), Props.paintBulb(c)))
}

/** A person sheet, painted the first time a look is needed; frames are numbered 0..11. */
export function ensurePerson(scene: Scene, look: PersonLook): string {
  const key = lookKey(look)
  if (scene.textures.exists(key)) return key
  const tex = scene.textures.addCanvas(key, toCanvas(paintPerson(look)))
  if (!tex) throw new Error(`could not add texture ${key}`)
  const count = SHEET_FACINGS.length * PERSON.frames
  for (let i = 0; i < count; i++) tex.add(i, 0, i * PERSON.w, 0, PERSON.w, PERSON.h)
  return key
}

export { TILE }
