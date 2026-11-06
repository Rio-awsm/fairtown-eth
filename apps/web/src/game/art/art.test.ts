import { describe, expect, it } from "vitest"
import { MARKET_BUILDINGS } from "../map/anchors"
import { BUILDING_SPRITE, BUILDING_THEMES, chimneyAt, paintBuilding, windowsAt } from "./buildings"
import { P } from "./palette"
import { PERSON, SHEET_FACINGS, frameOf, lookFor, lookKey, paintPerson } from "./people"
import { Pix, hashOf, rgb, rng } from "./pix"
import { GOODS, GOOD_OF, paintGood, paintTree } from "./props"
import { runsOf } from "./runs"
import { GID, TILE, TILE_NAMES, grassAt, paintTileset } from "./tiles"

const same = (a: Pix, b: Pix) => Buffer.from(a.data).equals(Buffer.from(b.data))

describe("Pix", () => {
  it("paints, clips out-of-bounds pixels and reads colours back", () => {
    const p = new Pix(4, 3).px(1, 1, "#ff0000").px(9, 9, "#00ff00").rect(-2, 0, 3, 1, "#0000ff")
    expect(p.hexAt(1, 1)).toBe("#ff0000")
    expect(p.hexAt(0, 0)).toBe("#0000ff")
    expect(p.hexAt(3, 2)).toBeNull()
  })

  it("outlines only the transparent pixels touching the shape", () => {
    const p = new Pix(5, 5).px(2, 2, "#ff0000").outline("#000000")
    expect([p.hexAt(2, 1), p.hexAt(1, 2), p.hexAt(3, 2), p.hexAt(2, 3)]).toEqual(Array(4).fill("#000000"))
    expect(p.hexAt(1, 1)).toBeNull()
    expect(p.hexAt(2, 2)).toBe("#ff0000")
  })

  it("rejects a bad size, a bad colour and an unknown pattern key", () => {
    expect(() => new Pix(0, 4)).toThrow(/bad size/)
    expect(() => rgb("red" as "#000000")).toThrow(/rrggbb/)
    expect(() => new Pix(2, 2).pattern(0, 0, ["x"], {})).toThrow(/no colour/)
  })

  it("seeds randomness and hashes deterministically", () => {
    expect(rng(5)()).toBe(rng(5)())
    expect(rng(5)()).not.toBe(rng(6)())
    expect(hashOf("agent-1")).toBe(hashOf("agent-1"))
  })
})

describe("tileset", () => {
  it("keeps the map's first seven tile ids and paints one 16 px tile per name", () => {
    expect(TILE_NAMES.slice(0, 7)).toEqual(["grass", "water", "road", "wall", "roof", "decor", "block"])
    const p = paintTileset()
    expect([p.w, p.h]).toEqual([TILE * TILE_NAMES.length, TILE])
    for (let i = 0; i < TILE_NAMES.length; i++) expect(p.alphaAt(i * TILE + 8, 8), TILE_NAMES[i]).toBe(255)
  })

  it("is the same every run", () => {
    expect(same(paintTileset(), paintTileset())).toBe(true)
  })

  it("picks only grass variants for the ground", () => {
    const grass = new Set([GID.grass, GID.grass_tufts, GID.grass_dark, GID.grass_flowers, GID.grass_roses])
    for (let y = 0; y < 34; y++) for (let x = 0; x < 60; x++) expect(grass.has(grassAt(x, y))).toBe(true)
  })
})

describe("buildings", () => {
  it.each(MARKET_BUILDINGS)("%s fills its sprite, with a door at the bottom centre", (b) => {
    const p = paintBuilding(b)
    expect([p.w, p.h]).toEqual([BUILDING_SPRITE.w, BUILDING_SPRITE.h])
    expect(p.alphaAt(BUILDING_SPRITE.w / 2, 80)).toBe(255)
    expect(p.alphaAt(0, 0)).toBe(0)
  })

  it("gives every market its own roof colour", () => {
    const roofs = MARKET_BUILDINGS.map((b) => BUILDING_THEMES[b].roof[1])
    expect(new Set(roofs).size).toBe(MARKET_BUILDINGS.length)
  })

  it("puts chimney smoke and window glow inside the sprite", () => {
    for (const b of MARKET_BUILDINGS) {
      for (const at of [chimneyAt(b), ...windowsAt(b)].filter((a) => a !== null)) {
        expect(at.x).toBeGreaterThan(0)
        expect(at.x).toBeLessThan(BUILDING_SPRITE.w)
        expect(at.y).toBeLessThan(BUILDING_SPRITE.h)
      }
    }
    expect(windowsAt("cold_vault")).toEqual([])
  })
})

describe("people", () => {
  it("paints 4 facings × 3 frames, outlined in ink", () => {
    const p = paintPerson(lookFor("agent-7", "SELLER"))
    expect([p.w, p.h]).toEqual([PERSON.w * PERSON.frames * SHEET_FACINGS.length, PERSON.h])
    expect(p.colours().has(P.ink)).toBe(true)
    for (let f = 0; f < 12; f++) expect(runsOf(p, f * PERSON.w, 0, PERSON.w, PERSON.h).length).toBeGreaterThan(10)
  })

  it("keeps the same look for the same agent, and dresses by role", () => {
    expect(lookFor("0xabc", "BUYER")).toEqual(lookFor("0xabc", "BUYER"))
    expect(lookKey(lookFor("0xabc", "BUYER"))).not.toBe(lookKey(lookFor("0xabc", "SELLER")))
    expect(lookFor("anyone", "TRUCK").style).toBe("cap")
  })

  it("numbers frames by facing then step", () => {
    expect(frameOf("down", 0)).toBe(0)
    expect(frameOf("up", 2)).toBe(11)
  })
})

describe("props", () => {
  it("has an icon for every commodity the town lists", () => {
    for (const good of Object.values(GOOD_OF)) expect(GOODS[good]).toBeDefined()
    for (const name of Object.keys(GOODS)) expect(paintGood(name).colours().size).toBeGreaterThan(0)
  })

  it("draws trees the same each time for a seed", () => {
    expect(same(paintTree(3), paintTree(3))).toBe(true)
    expect(same(paintTree(3), paintTree(4))).toBe(false)
  })
})

describe("runsOf", () => {
  it("merges same-colour pixels into one run and skips transparency", () => {
    const p = new Pix(5, 1).rect(0, 0, 3, 1, "#ff0000").px(4, 0, "#00ff00")
    expect(runsOf(p)).toEqual([
      { x: 0, y: 0, w: 3, c: "#ff0000", a: 255 },
      { x: 4, y: 0, w: 1, c: "#00ff00", a: 255 },
    ])
  })
})
