import { loadEnv } from "@fairtown/shared/env"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { writerAccount } from "../src/adapters"
import { SwarmStore } from "../src/addons/swarm/store"
import { LiveArkivStore } from "../src/arkiv/LiveArkivStore"

// pnpm -F agents swarm:check [photo]. One upload and one read (the swarm.md reproduction): upload a photo through our Bee
// node, read it back from the node and from bzz.limo, then write a lot entity on Arkiv whose details carry the photo hash
// and the plain Swarm reference. Prints the entity key and links. Keys are never printed.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
if (!env.SWARM_BATCH_ID) throw new Error("Needs SWARM_BATCH_ID (run pnpm -F agents swarm:fund)")
const swarm = new SwarmStore({ beeUrl: env.SWARM_BEE_URL ?? "http://127.0.0.1:1633", batchId: env.SWARM_BATCH_ID, gateway: env.SWARM_GATEWAY ?? "https://bzz.limo", timeoutMs: 60_000 })
console.log(`Node: ${JSON.stringify(await swarm.health())}`)

const path = process.argv[2]
const bytes = path ? new Uint8Array(readFileSync(path)) : new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"))
const mediaType = path?.match(/\.png$/i) ? "image/png" : path ? "image/jpeg" : "image/png"
const hash = `0x${createHash("sha256").update(bytes).digest("hex")}`
const t0 = Date.now()
const ref = await swarm.upload(bytes, mediaType, `${hash.slice(2, 14)}.${mediaType.split("/")[1]}`)
if (!ref) throw new Error(`Upload failed: ${swarm.lastError}`)
console.log(`Uploaded ${bytes.length} bytes in ${Date.now() - t0} ms: reference ${ref}`)

const back = await swarm.read(ref)
console.log(`Read from our node: ${back ? `${back.bytes.length} bytes, sha256 ${back && createHash("sha256").update(back.bytes).digest("hex") === hash.slice(2) ? "matches" : "DIFFERS"}` : "failed"}`)
const gw = await fetch(swarm.url(ref), { signal: AbortSignal.timeout(60_000) }).catch(() => undefined)
console.log(`Read from ${swarm.url(ref)}: ${gw ? `HTTP ${gw.status}` : "unreachable (gateway may need a few minutes to see new chunks)"}`)

if (env.ARKIV_ACCESS_KEY && env.ARKIV_PRIVATE_KEY) {
  const writer = writerAccount(env.ARKIV_PRIVATE_KEY)
  const arkiv = new LiveArkivStore({ accessKey: env.ARKIV_ACCESS_KEY, writer })
  const lotId = BigInt(Date.now())
  const details = { photos: [hash], swarm: [{ hash, ref }], simulated: "Swarm proof lot (S2 8.5 swarm:check), not a real sale" }
  const r = await arkiv.put(
    ARKIV_SCHEMAS.lot,
    { sector: "fish", commodity: "cod", grade: "fresh_a", market: "fish_dock", place: "bergen", currency: "EUR", status: "open", lotId, auction: "0x0000000000000000000000000000000000000000", floorPerUnit: 7_500_000n, endBlock: 0n, parentLotId: 0n, details: new TextEncoder().encode(JSON.stringify(details)) },
    { owner: writer.address, expiresInSeconds: 30 * 86_400, dedupe: { lotId } },
  )
  console.log(`Arkiv lot entity ${r.key} (lotId ${lotId}) holds Swarm reference ${ref}: https://rabdi.explorer.arkiv.network/entity/${r.key}`)
}
