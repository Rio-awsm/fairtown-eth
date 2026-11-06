import { loadEnv } from "@fairtown/shared/env"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { formatEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { EnsClient, txUrl, type EnsState } from "../src/addons/ens/client"

// pnpm -F agents ens:setup. One-time and idempotent: resolver and registry proxies, then the parent .eth name pointing at
// both, then its records. Writes public addresses and tx hashes to src/addons/ens/sepolia.json. Never prints the key.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
if (!env.ENS_PRIVATE_KEY || !env.ENS_SEPOLIA_RPC_URL) throw new Error("Needs ENS_PRIVATE_KEY and ENS_SEPOLIA_RPC_URL")
const parent = env.ENS_PARENT_NAME ?? "fairtown.eth"
const label = parent.replace(/\.eth$/, "")
const account = privateKeyToAccount(env.ENS_PRIVATE_KEY as `0x${string}`)
const ens = new EnsClient(env.ENS_SEPOLIA_RPC_URL, account)
const file = new URL("../src/addons/ens/sepolia.json", import.meta.url)
const prev: Partial<EnsState> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
const txs: Record<string, `0x${string}`> = { ...(prev.txs ?? {}) }

console.log(`Wallet ${account.address}, ${formatEther(await ens.pub.getBalance({ address: account.address }))} Sepolia ETH; parent ${parent}`)
const resolver = await ens.deployResolver()
if (resolver.tx) txs.resolver = resolver.tx
console.log(`Resolver proxy ${resolver.address}${resolver.tx ? ` (${txUrl(resolver.tx)})` : " (existing)"}`)
const registry = await ens.deployRegistry(parent)
if (registry.tx) txs.registry = registry.tx
console.log(`UserRegistry proxy ${registry.address}${registry.tx ? ` (${txUrl(registry.tx)})` : " (existing)"}`)

const state: EnsState = { parent, resolver: resolver.address, registry: registry.address, owner: account.address, txs }
writeFileSync(file, JSON.stringify(state, null, 2) + "\n")

if (await ens.isAvailable(label)) {
  console.log(`Registering ${parent} (commit, wait, register)...`)
  Object.assign(txs, await ens.registerParent(label, registry.address, resolver.address, (s) => console.log(`  waiting ${s} s for the commitment to age`)))
  for (const k of ["mint", "approve", "commit", "register"]) if (txs[k]) console.log(`  ${k}: ${txUrl(txs[k]!)}`)
} else console.log(`${parent} is already registered`)

const rec = await ens.setRecords(state, parent, {
  description: "Fairtown: an open market for anything with an expiry date. Agent names live under this name.",
  url: "https://github.com/Rio-awsm/fairtown-eth",
  "fairtown.registry": registry.address,
})
txs.parentRecords = rec.hash
writeFileSync(file, JSON.stringify({ ...state, txs }, null, 2) + "\n")
console.log(`Parent records: ${txUrl(rec.hash)}`)
console.log(`\nResolved through ENS (UniversalResolverV2): description = ${JSON.stringify(await ens.text(parent, "description"))}`)
console.log(`Saved ${file.pathname.split("/services/")[1]}`)
