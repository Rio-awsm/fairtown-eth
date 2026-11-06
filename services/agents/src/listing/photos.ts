import type { Photo } from "@fairtown/shared/api"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { z } from "zod"

export type PhotoInput = z.infer<typeof Photo>
export type StoredPhoto = {
  hash: `0x${string}`
  file: string
  mediaType: string
  lotCode: string
  capturedAt: string
  gps?: { lat: number; lon: number }
  dataUrl: string
  swarmRef?: string // ADDON_SWARM: plain 64-hex reference of the same bytes on Swarm
}
export type PhotoCheck = { photos: StoredPhoto[]; flags: string[] }

// D-20: photos stay on local disk; only the hash goes to Arkiv.
// Reuse is detected by exact SHA-256. A perceptual hash would also catch re-encoded copies (see NOTES.md).
export class PhotoStore {
  private readonly seen = new Set<string>()
  private readonly dir: string

  constructor(storageDir: string) {
    this.dir = join(storageDir, "photos")
    mkdirSync(this.dir, { recursive: true })
    for (const f of readdirSync(this.dir)) this.seen.add(f.split(".")[0]!)
  }

  check(photos: PhotoInput[], expectedLotCode?: string): PhotoCheck {
    const flags: string[] = []
    const out: StoredPhoto[] = []
    const codes = new Set(photos.map((p) => p.lotCode))
    if (codes.size > 1) flags.push("Photos carry different lot codes")
    if (expectedLotCode && !codes.has(expectedLotCode)) flags.push(`Lot code ${expectedLotCode} not in the request`)
    for (const p of photos) {
      const m = p.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
      if (!m) {
        flags.push("A photo is not a base64 image")
        continue
      }
      const bytes = Buffer.from(m[2]!, "base64")
      const hex = createHash("sha256").update(bytes).digest("hex")
      if (this.seen.has(hex)) flags.push(`Photo ${hex.slice(0, 10)} was used in an earlier listing`)
      const ext = m[1]!.split("/")[1]!.replace("jpeg", "jpg")
      const file = join(this.dir, `${hex}.${ext}`)
      if (!existsSync(file)) writeFileSync(file, bytes)
      out.push({
        hash: `0x${hex}`,
        file,
        mediaType: m[1]!,
        lotCode: p.lotCode,
        capturedAt: p.capturedAt,
        ...(p.gps ? { gps: p.gps } : {}),
        dataUrl: p.dataUrl,
      })
    }
    for (const p of out) this.seen.add(p.hash.slice(2))
    if (!out.some((p) => p.gps)) if (out.length) flags.push("No GPS on photos")
    return { photos: out, flags }
  }
}
