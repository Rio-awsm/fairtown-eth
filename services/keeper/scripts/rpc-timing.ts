/** Times each RPC step viem takes before broadcasting (no tx is sent). pnpm -F keeper exec tsx scripts/rpc-timing.ts */
import { fileURLToPath } from "node:url"
import { createPublicClient, createWalletClient, http } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { loadEnv, safeErrorMessage } from "../src/lib"
const { env } = loadEnv(fileURLToPath(new URL("../../../.env", import.meta.url)))
const transport = http(env.RPC_URL, { timeout: 30_000 })
const pub = createPublicClient({ chain: baseSepolia, transport })
const acct = mnemonicToAccount(env.AGENT_MNEMONIC!.trim(), { addressIndex: 91 })
const w = createWalletClient({ account: acct, chain: baseSepolia, transport })
async function t(label: string, f: () => Promise<unknown>) {
  const s = Date.now()
  try {
    await f()
    console.log(`${label}: ${Date.now() - s} ms`)
  } catch (e) {
    console.log(`${label}: FAILED after ${Date.now() - s} ms: ${safeErrorMessage(e, [env.RPC_URL])}`)
  }
}
await t("getBlockNumber", () => pub.getBlockNumber())
await t("getChainId", () => pub.getChainId())
await t("getBlock latest", () => pub.getBlock())
await t("estimateFeesPerGas", () => pub.estimateFeesPerGas())
await t("eth_maxPriorityFeePerGas", () => pub.estimateMaxPriorityFeePerGas())
await t("getTransactionCount pending", () => pub.getTransactionCount({ address: acct.address, blockTag: "pending" }))
await t("prepareTransactionRequest (gas+nonce given)", () =>
  w.prepareTransactionRequest({ to: acct.address, value: 0n, gas: 21000n, nonce: 0 }),
)
await t("prepareTransactionRequest (nothing given)", () => w.prepareTransactionRequest({ to: acct.address, value: 0n }))
if (process.argv.includes("--send")) {
  // One zero-value self-transfer (about 21k gas) to time the broadcast and the receipt separately.
  let hash: `0x${string}` | undefined
  await t("sendTransaction (broadcast only)", async () => {
    hash = await w.sendTransaction({ to: acct.address, value: 0n })
  })
  if (hash) {
    const sent = await pub.getBlockNumber()
    await t("waitForTransactionReceipt", () => pub.waitForTransactionReceipt({ hash: hash!, pollingInterval: 1_000 }))
    const r = await pub.getTransactionReceipt({ hash })
    console.log(`sent at block ${sent}, mined in block ${r.blockNumber}`)
  }
}
