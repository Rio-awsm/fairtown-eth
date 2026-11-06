import { loadEnv } from "@fairtown/shared/env"
import { readFileSync, writeFileSync } from "node:fs"
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, type Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { gnosis } from "viem/chains"

// pnpm -F agents swarm:fund. One-time: moves the Swarm gift wallet's xBZZ and most of its xDAI to our Bee node's wallet,
// waits for the node's chequebook, buys a small postage batch (depth 17, ~30 days or what the xBZZ covers), waits until it is
// usable and writes SWARM_BATCH_ID to .env. The gift key is read from .env and never printed.
const XBZZ = "0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da" as const
const DEPTH = 17
const BLOCK_SECONDS = 5 // Gnosis Chain
const envPath = new URL("../../../.env", import.meta.url).pathname
const { env } = loadEnv(envPath)
const bee = (env.SWARM_BEE_URL ?? "http://127.0.0.1:1633").replace(/\/+$/, "")
const j = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(`${bee}${path}`, init)
  if (!r.ok) throw new Error(`Bee ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`)
  return (await r.json()) as T
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The node's wallet (stable across restarts): from the running node, else SWARM_NODE_ADDRESS (funding works with it stopped).
const node = ((await j<{ ethereum: Address }>("/addresses").then((r) => r.ethereum).catch(() => undefined)) ?? env.SWARM_NODE_ADDRESS) as Address
if (!node) throw new Error("Bee node not running and no SWARM_NODE_ADDRESS in .env")
console.log(`Bee node wallet ${node}`)
const pub = createPublicClient({ chain: gnosis, transport: http("https://rpc.gnosischain.com") })
const nodeBzz = () => pub.readContract({ address: XBZZ, abi: erc20Abi, functionName: "balanceOf", args: [node] })

if ((await nodeBzz()) === 0n) {
  const k = (env.SWARM_GIFT_KEY ?? "").trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("Put the Swarm gift code in .env as SWARM_GIFT_KEY=0x... first")
  const gift = privateKeyToAccount(k as `0x${string}`)
  const w = createWalletClient({ chain: gnosis, transport: http("https://rpc.gnosischain.com"), account: gift })
  const bzz = await pub.readContract({ address: XBZZ, abi: erc20Abi, functionName: "balanceOf", args: [gift.address] })
  const dai = await pub.getBalance({ address: gift.address })
  console.log(`Gift wallet ${gift.address}: ${formatUnits(bzz, 16)} xBZZ, ${formatEther(dai)} xDAI`)
  if (bzz > 0n) {
    const h = await w.writeContract({ address: XBZZ, abi: erc20Abi, functionName: "transfer", args: [node, bzz] })
    await pub.waitForTransactionReceipt({ hash: h })
    console.log(`  xBZZ -> node: https://gnosisscan.io/tx/${h}`)
  }
  const keep = 2n * 10n ** 15n // 0.002 xDAI stays for this transfer's gas
  const left = await pub.getBalance({ address: gift.address })
  if (left > keep) {
    const h = await w.sendTransaction({ to: node, value: left - keep })
    await pub.waitForTransactionReceipt({ hash: h })
    console.log(`  xDAI -> node: https://gnosisscan.io/tx/${h}`)
  }
} else console.log("Node already holds xBZZ; skipping the transfer")

// The node deploys its chequebook once it sees xDAI; uploads and stamps need it. Start it with pnpm -F agents swarm:node.
console.log("Waiting for the Bee node (start it with: pnpm -F agents swarm:node)...")
for (let i = 0; i < 120; i++) {
  const ready = await fetch(`${bee}/readiness`).then((r) => r.ok).catch(() => false)
  const cb = await j<{ chequebookAddress?: string }>("/chequebook/address").catch(() => ({ chequebookAddress: "" }))
  if (ready && cb.chequebookAddress && !/^0x0+$/.test(cb.chequebookAddress)) break
  if (i % 6 === 0) console.log("  waiting for the node's chequebook and readiness...")
  await wait(5000)
}

const existing = (await j<{ stamps: Array<{ batchID: string; usable: boolean; batchTTL: number }> }>("/stamps")).stamps.find((s) => s.batchTTL > 86_400)
let batch = existing?.batchID
if (!batch) {
  const { currentPrice } = await j<{ currentPrice: string }>("/chainstate")
  const price = BigInt(currentPrice)
  const wallet = await j<{ bzzBalance: string }>("/wallet")
  const budget = (BigInt(wallet.bzzBalance) * 9n) / 10n // keep 10% headroom
  let days = 30n
  const cost = (d: bigint) => price * ((d * 86_400n) / BigInt(BLOCK_SECONDS)) * 2n ** BigInt(DEPTH)
  while (days > 1n && cost(days) > budget) days--
  const amount = price * ((days * 86_400n) / BigInt(BLOCK_SECONDS))
  console.log(`Buying a depth-${DEPTH} batch for ~${days} days: ${formatUnits(cost(days), 16)} xBZZ of ${formatUnits(BigInt(wallet.bzzBalance), 16)}`)
  batch = (await j<{ batchID: string }>(`/stamps/${amount}/${DEPTH}`, { method: "POST" })).batchID
}
for (let i = 0; i < 60; i++) {
  const s = await j<{ usable: boolean; batchTTL: number }>(`/stamps/${batch}`).catch(() => ({ usable: false, batchTTL: 0 }))
  if (s.usable) {
    console.log(`Batch ${batch} usable, TTL ~${Math.round(s.batchTTL / 86_400)} days`)
    break
  }
  if (i % 6 === 0) console.log("  waiting for the batch to become usable...")
  await wait(5000)
}
let text = readFileSync(envPath, "utf8")
text = /^SWARM_BATCH_ID=.*$/m.test(text) ? text.replace(/^SWARM_BATCH_ID=.*$/m, `SWARM_BATCH_ID=${batch}`) : `${text.replace(/\n*$/, "\n")}SWARM_BATCH_ID=${batch}\n`
writeFileSync(envPath, text)
console.log("Wrote SWARM_BATCH_ID to .env")
