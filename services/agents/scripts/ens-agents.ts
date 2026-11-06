import { loadEnv } from "@fairtown/shared/env"
import { readFileSync } from "node:fs"
import { formatEther, type Address } from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { EnsAgents } from "../src/addons/ens/agents"
import { EnsClient } from "../src/addons/ens/client"
import { PERSONAS } from "../src/fixtures/personas"
import type { RuntimeAgent } from "../src/runtime/types"

// pnpm -F agents ens:agents. Registers <persona>.fairtown.eth for all 27 personas (idempotent), owned by each agent's wallet
// from AGENT_MNEMONIC (index = persona order), then resolves a few names back through ENS.
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
if (!env.ENS_PRIVATE_KEY || !env.ENS_SEPOLIA_RPC_URL || !env.AGENT_MNEMONIC) throw new Error("Needs ENS_PRIVATE_KEY, ENS_SEPOLIA_RPC_URL and AGENT_MNEMONIC")
const state = JSON.parse(readFileSync(new URL("../src/addons/ens/sepolia.json", import.meta.url), "utf8"))
const ens = new EnsClient(env.ENS_SEPOLIA_RPC_URL, privateKeyToAccount(env.ENS_PRIVATE_KEY as `0x${string}`))
const errors: string[] = []
const agents = new EnsAgents({ ens, state, personas: PERSONAS, onError: (w, e) => errors.push(`${w}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`) })
const before = await ens.pub.getBalance({ address: ens.account.address })
const started = Date.now()
const list: RuntimeAgent[] = PERSONAS.map((p, i) => ({
  agentId: mnemonicToAccount(env.AGENT_MNEMONIC!, { addressIndex: i }).address.toLowerCase() as Address,
  name: p.name,
  role: p.role,
  kind: p.kind,
  building: p.building,
  sprite: p.sprite,
  currency: p.currency,
  budget: BigInt(p.budget),
  ...(p.mandate ? { mandate: p.mandate } : {}),
  paused: false,
  walletIndex: i,
  personaId: p.id,
}))
for (const a of list) {
  const name = await agents.register(a)
  console.log(`${name ?? "FAILED"}  ->  ${a.agentId}`)
}
const after = await ens.pub.getBalance({ address: ens.account.address })
console.log(`\n${agents.log.filter((l) => l.startsWith("registered")).length} new, ${list.length} total, ${Math.round((Date.now() - started) / 1000)} s, gas ${formatEther(before - after)} ETH, left ${formatEther(after)} ETH`)
if (errors.length) console.log("Errors:", errors)
for (const id of ["ingrid", "hanse-kitchen", "coastal-catch"]) {
  const n = `${id}.${state.parent}`
  console.log(`resolve ${n}: addr ${await ens.address(n)}, role ${await ens.text(n, "fairtown.role")}, verified ${await ens.text(n, "fairtown.verified")}, mandate ${await ens.text(n, "fairtown.mandate")}`)
}
