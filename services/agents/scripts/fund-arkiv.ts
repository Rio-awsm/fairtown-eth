import { loadEnv } from "@fairtown/shared/env"
import { parseEther, type Address } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { writerAccount } from "../src/adapters"
import { fundArkivWallets } from "../src/arkiv/fundArkivWallets"
import { PERSONAS } from "../src/fixtures/personas"

// pnpm -F agents fund:arkiv [glmPerWallet]. Funds one wallet per persona from AGENT_MNEMONIC (index = persona order).
const { env } = loadEnv(new URL("../../../.env", import.meta.url).pathname)
if (!env.AGENT_MNEMONIC) {
  console.log("AGENT_MNEMONIC is empty. Agent wallets arrive in S2 3.1; until then the writer key owns every entity.")
  process.exit(0)
}
const each = parseEther(process.argv[2] ?? "0.05")
const to = PERSONAS.filter((p) => p.role !== "HUMAN").map((_, i) => mnemonicToAccount(env.AGENT_MNEMONIC!, { addressIndex: i }).address as Address)
const res = await fundArkivWallets({ accessKey: env.ARKIV_ACCESS_KEY!, from: writerAccount(env.ARKIV_PRIVATE_KEY!), to, topUpTo: each, minBalance: each / 2n })
for (const r of res) console.log(r.address, r.sent > 0n ? `sent ${r.sent} wei tx ${r.tx}` : `ok (${r.before} wei)`)
