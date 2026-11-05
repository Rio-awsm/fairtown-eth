import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { crc32, deflateSync } from "node:zlib"
import { STUB_TILE_COLOURS, TILE, buildStubMap } from "../src/game/map/stub-map"

/** Writes the stub town.tmj and its tileset PNG. Our own art, credited in CREDITS.md. */
const out = (rel: string) => fileURLToPath(new URL(`../public/assets/${rel}`, import.meta.url))

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "ascii"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const width = TILE * STUB_TILE_COLOURS.length
const pixels = new Uint8Array(width * TILE * 4)
STUB_TILE_COLOURS.forEach((hex, t) => {
  const [r, g, b] = rgb(hex)
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      // A 1 px darker edge so single tiles read on a projector.
      const shade = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1 ? 0.8 : 1
      const i = (y * width + t * TILE + x) * 4
      pixels.set([Math.round(r! * shade), Math.round(g! * shade), Math.round(b! * shade), 255], i)
    }
})

writeFileSync(out("tiles/fairtown-stub.png"), png(width, TILE, pixels))
writeFileSync(out("maps/town.tmj"), JSON.stringify(buildStubMap()))
console.log("wrote public/assets/maps/town.tmj and public/assets/tiles/fairtown-stub.png")
