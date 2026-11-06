import { loadEnv } from "@fairtown/shared/env"
import { writerAccount } from "../src/adapters"
import { LedgerWriter } from "../src/arkiv/ledgerWriter"
import { LiveArkivStore } from "../src/arkiv/LiveArkivStore"
import { recordDay } from "../src/load/record"

// pnpm -F agents arkiv:seed. Plays full_day on FakeChain and mirrors it into Arkiv (Rabdi) with the normal ledger writer,
// so the board, advice and floors have real Arkiv data. Every lot entity says it came from a simulated day.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
if (!env.ARKIV_ACCESS_KEY || !env.ARKIV_PRIVATE_KEY) throw new Error("Needs ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY in .env")
const writer = writerAccount(env.ARKIV_PRIVATE_KEY)
const notes: string[] = []
const arkiv = new LiveArkivStore({ accessKey: env.ARKIV_ACCESS_KEY, writer, onFriction: (n) => notes.push(n) })
const errors: string[] = []
let ledger: LedgerWriter | undefined
const started = Date.now()
const r = await recordDay({
  ledger: (chain) =>
    (ledger = new LedgerWriter({
      chain,
      arkiv,
      writer: writer.address,
      detailsFor: () => ({ simulated: "full_day scenario on FakeChain (S2 7.1 seed), not a real sale" }),
      onError: (e, ev) => errors.push(`${ev}: ${(e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "<url>").slice(0, 160)}`),
    })),
})
console.log(`Simulated ${r.blocks} blocks; waiting for Arkiv writes...`)
await ledger!.idle()
console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s. Writer ${writer.address}`)
console.log("Written:", ledger!.written, "Retried:", ledger!.retried, "Failed:", ledger!.failed)
if (errors.length) console.log("Errors:", errors.slice(0, 10))
if (notes.length) console.log("Friction notes:", notes.slice(0, 10))
