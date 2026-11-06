import { loadEnv } from "@fairtown/shared/env"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { writerAccount } from "../src/adapters"
import { LiveArkivStore } from "../src/arkiv/LiveArkivStore"

// pnpm -F agents arkiv:stats. Counts every Fairtown entity on Rabdi by schema and owner, then runs the price query the
// seller advice uses. Prints addresses and counts only, never keys.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
// Reading needs only an access key (free at hub.arkiv.network/access-keys); no private key, a throwaway signer is used.
if (!env.ARKIV_ACCESS_KEY) throw new Error("Needs ARKIV_ACCESS_KEY (free at https://hub.arkiv.network/access-keys)")
const writer = env.ARKIV_PRIVATE_KEY ? writerAccount(env.ARKIV_PRIVATE_KEY) : privateKeyToAccount(generatePrivateKey())
const store = new LiveArkivStore({ accessKey: env.ARKIV_ACCESS_KEY, writer })
const FAIRTOWN_WRITER = "0x8BA90d413a1b48321De0D77CCF8C201A7086b2ef"
console.log(`Fairtown writer: ${FAIRTOWN_WRITER}${env.ARKIV_PRIVATE_KEY ? ` (this .env: ${writer.address})` : ""}`)
for (const [name, schema] of Object.entries(ARKIV_SCHEMAS)) {
  let n = 0
  const owners = new Map<string, number>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const r = await store.query(schema, {}, { limit: 100, ...(cursor ? { cursor } : {}) })
    for (const e of r.entities) owners.set(e.owner, (owners.get(e.owner) ?? 0) + 1)
    n += r.entities.length
    if (!r.cursor || !r.entities.length) break
    cursor = r.cursor
  }
  console.log(`${schema.name}: ${n} live entities, ${owners.size} owner(s): ${[...owners].map(([o, c]) => `${o} (${c})`).join(", ")}`)
}
const t0 = Date.now()
const prices = await store.query(ARKIV_SCHEMAS.price, { commodity: "cod", place: "bergen" }, { limit: 10, orderBy: { field: "lotId", dir: "desc" } })
console.log(`\nprice where commodity=cod and place=bergen, newest 10 (${Date.now() - t0} ms):`)
for (const e of prices.entities) console.log(`  lot ${e.values.lotId}: clearing ${e.values.finalClearingPerUnit}, avg ${e.values.avgPerUnit}, sold ${e.values.soldUnits}, ${e.values.currency}, day ${e.values.day}`)
