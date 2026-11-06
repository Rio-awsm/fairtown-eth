import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parseTownMap } from "./anchors"

const webRoot = fileURLToPath(new URL("../../../", import.meta.url))
const mapPath = `${webRoot}public/assets/maps/town.tmj`
const json: unknown = JSON.parse(readFileSync(mapPath, "utf8"))
const credits = readFileSync(`${webRoot}CREDITS.md`, "utf8")
const images = ((json as { tilesets?: { image?: string }[] }).tilesets ?? []).flatMap((t) => (t.image ? [t.image] : []))

describe("public/assets/maps/town.tmj", () => {
  it("has every anchor, layer and an embedded, uncompressed tileset", () => {
    const r = parseTownMap(json)
    expect(r.ok ? [] : r.problems).toEqual([])
  })

  it.each(images)("tileset image %s exists", (image) => {
    expect(existsSync(fileURLToPath(new URL(image, `file://${webRoot}public/assets/maps/`)))).toBe(true)
  })

  it.each(images)("tileset image %s is credited in CREDITS.md", (image) => {
    expect(credits).toContain(image.split("/").at(-1)!)
  })
})
