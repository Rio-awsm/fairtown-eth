import { AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey, TokenAssociateTransaction, TokenId } from "@hiero-ledger/sdk"
import { loadEnv } from "@fairtown/shared/env"
import { readFileSync, writeFileSync } from "node:fs"

// pnpm -F agents hedera:setup. Idempotent. The merchant account (HEDERA_ACCOUNT_ID) is associated with testnet USDC; a buyer
// agent account is created (25 HBAR, auto token association) and its key goes straight into .env. Keys are never printed.
const USDC = "0.0.429274" // @x402/hedera HEDERA_TESTNET_USDC (source), not the README's 0.0.6001
const envPath = new URL("../../../.env", import.meta.url).pathname
const { env } = loadEnv(envPath)
if (!env.HEDERA_ACCOUNT_ID || !env.HEDERA_PRIVATE_KEY) throw new Error("Needs HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY")
const key = (k: string) => (k.trim().startsWith("30") ? PrivateKey.fromStringDer(k.trim()) : PrivateKey.fromStringECDSA(k.trim()))
const merchant = AccountId.fromString(env.HEDERA_ACCOUNT_ID)
const client = Client.forTestnet().setOperator(merchant, key(env.HEDERA_PRIVATE_KEY))
const mirror = async (id: string) =>
  (await (await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${id}`)).json()) as { balance?: { balance?: number; tokens?: Array<{ token_id: string; balance: number }> } }
const hashscan = (path: string) => `https://hashscan.io/testnet/${path}`

const m = await mirror(merchant.toString())
if (!(m.balance?.tokens ?? []).some((t) => t.token_id === USDC)) {
  const r = await (await new TokenAssociateTransaction().setAccountId(merchant).setTokenIds([TokenId.fromString(USDC)]).execute(client)).getReceipt(client)
  console.log(`Merchant ${merchant} associated with USDC ${USDC}: ${r.status}`)
} else console.log(`Merchant ${merchant} already associated with USDC`)

let agentId = env.HEDERA_AGENT_ACCOUNT_ID
if (!agentId) {
  const agentKey = PrivateKey.generateECDSA()
  const tx = await new AccountCreateTransaction().setECDSAKeyWithAlias(agentKey).setInitialBalance(new Hbar(25)).setMaxAutomaticTokenAssociations(10).execute(client)
  const receipt = await tx.getReceipt(client)
  agentId = receipt.accountId!.toString()
  let text = readFileSync(envPath, "utf8").replace(/\n*$/, "\n")
  text += `HEDERA_AGENT_ACCOUNT_ID=${agentId}\nHEDERA_AGENT_PRIVATE_KEY=${agentKey.toStringDer()}\n`
  writeFileSync(envPath, text)
  console.log(`Created buyer agent account ${agentId} (25 HBAR): ${hashscan(`transaction/${tx.transactionId.toString()}`)}`)
} else console.log(`Buyer agent account ${agentId} already exists`)

const a = await mirror(agentId)
console.log(`\nMerchant: ${hashscan(`account/${merchant}`)}, ${(m.balance?.balance ?? 0) / 1e8} HBAR`)
console.log(`Agent:    ${hashscan(`account/${agentId}`)}, ${(a.balance?.balance ?? 0) / 1e8} HBAR, USDC ${((a.balance?.tokens ?? []).find((t) => t.token_id === USDC)?.balance ?? 0) / 1e6}`)
console.log(`\nFor USDC: faucet.circle.com -> Hedera Testnet -> send to ${agentId}`)
client.close()
