import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { png } from "./lib/png"
import { paintTileset } from "../src/game/art/tiles"
import { buildStubMap } from "../src/game/map/stub-map"

/** Writes the stub town.tmj and its tileset PNG. Our own art, credited in CREDITS.md. */
const out = (rel: string) => fileURLToPath(new URL(`../public/assets/${rel}`, import.meta.url))

const tileset = paintTileset()
writeFileSync(out("tiles/fairtown-town.png"), png(tileset.w, tileset.h, tileset.data))
writeFileSync(out("maps/town.tmj"), JSON.stringify(buildStubMap()))
console.log("wrote public/assets/maps/town.tmj and public/assets/tiles/fairtown-town.png")
