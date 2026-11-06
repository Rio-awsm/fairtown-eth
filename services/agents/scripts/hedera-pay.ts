import { loadEnv } from "@fairtown/shared/env"
import Fastify from "fastify"
import type { AddressInfo } from "node:net"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { LiveArkivStore } from "../src/arkiv/LiveArkivStore"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"
import { DEFAULT_POLICY, hederaClient, IntelBuyer, intelLine, mirrorBalances } from "../src/addons/hedera/buyer"
import { intelServer, registerIntelRoute } from "../src/addons/hedera/intel"

// pnpm -F agents hedera:pay [commodity]. Starts the paid intel endpoint locally (real Arkiv data if ARKIV_ACCESS_KEY is set)
// and has the buyer agent account pay for it through the x402 facilitator on Hedera testnet, with no human step.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
for (const k of ["HEDERA_ACCOUNT_ID", "HEDERA_AGENT_ACCOUNT_ID", "HEDERA_AGENT_PRIVATE_KEY"]) if (!env[k]) throw new Error(`Needs ${k} (run pnpm -F agents hedera:setup)`)
const commodity = process.argv[2] ?? "cod"
const arkiv = env.ARKIV_ACCESS_KEY ? new LiveArkivStore({ accessKey: env.ARKIV_ACCESS_KEY, writer: privateKeyToAccount(generatePrivateKey()) }) : new MemoryArkivStore()
const app = Fastify({ logger: false })
const settled: string[] = []
registerIntelRoute(app, { server: intelServer(env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator"), payTo: env.HEDERA_ACCOUNT_ID!, arkiv, onSettled: (tx) => settled.push(tx) })
await app.listen({ port: 0, host: "127.0.0.1" })
const host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`
const buyer = new IntelBuyer({ client: hederaClient(env.HEDERA_AGENT_ACCOUNT_ID!, env.HEDERA_AGENT_PRIVATE_KEY!), policy: DEFAULT_POLICY(env.HEDERA_ACCOUNT_ID!, host), balanceOf: mirrorBalances(env.HEDERA_AGENT_ACCOUNT_ID!) })

const t0 = Date.now()
const r = await buyer.buy("hanse_kitchen", `http://${host}/api/intel/${commodity}`, commodity)
console.log(`Paid request for ${commodity} intel by agent ${env.HEDERA_AGENT_ACCOUNT_ID} -> merchant ${env.HEDERA_ACCOUNT_ID}: ${Date.now() - t0} ms`)
if (!r.ok) console.log(`FAILED: ${r.reason}`)
else {
  console.log(`  settled tx: ${r.receipt?.transaction}`)
  console.log(`  HashScan:   ${r.receipt?.hashscan}`)
  console.log(`  paid:       ${r.receipt?.amount} of asset ${r.receipt?.asset}`)
  console.log(`  intel:      ${intelLine(r.intel)}`)
  console.log(`  agent spend so far: ${JSON.stringify(buyer.spentBy("hanse_kitchen"), (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`)
}
await app.close()
