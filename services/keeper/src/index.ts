/**
 * Fairtown keeper (S1 2.1): settles auctions at endBlock, exits and claims bids, assigns carriers, finalizes
 * uncontested no-shows, releases expired held money, and checkpoints live auctions (D-54).
 *   pnpm -F keeper dev                 (network from CHAIN_MODE)
 *   pnpm -F keeper dev base-sepolia    (or anvil)
 * Uses KEEPER_PRIVATE_KEY only. Never logs keys or the RPC URL. TEST MONEY only.
 */
import { fileURLToPath } from "node:url"
import { createPublicClient, createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { loadDeployment } from "@fairtown/shared/addresses"
import { keeperConfig } from "./config"
import { Keeper } from "./keeper"
import { loadEnv } from "./lib"
import { createLogger, errText } from "./log"
import { TxQueue, viemSender } from "./txQueue"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const secrets = [env.RPC_URL, env.FORK_RPC_URL, env.ANVIL_RPC_URL, env.KEEPER_PRIVATE_KEY]
const log = createLogger(secrets)

try {
  const cfg = keeperConfig(env, process.argv[2])
  const dep = await loadDeployment(cfg.network)
  // Fail fast on a dead connection (10 s x 3 tries); the loop retries next poll (S1 2.1 live run, NOTES).
  const transport = http(cfg.rpcUrl, { timeout: 10_000, retryCount: 2 })
  // No chain on the public client: reads need no OP-stack formatters, and it keeps the plain PublicClient type.
  const pub = createPublicClient({ transport })
  const account = privateKeyToAccount(cfg.keeperKey)
  const wallet = createWalletClient({ account, chain: baseSepolia, transport })
  const queue = new TxQueue(viemSender(pub, wallet), log, secrets)
  const keeper = new Keeper({ pub, queue, dep, log, checkpointEvery: cfg.checkpointEvery, secrets })
  log.info(
    {
      network: cfg.network,
      keeper: account.address,
      settlement: dep.contracts.MarketSettlement,
      fromBlock: dep.deployedAtBlock,
      checkpointEvery: cfg.checkpointEvery.toString(),
    },
    "keeper starting (TEST MONEY)",
  )
  const stop = new AbortController()
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => stop.abort())
  await keeper.loop(cfg.pollMs, stop.signal)
  log.info(queue.stats, "keeper stopped")
} catch (e) {
  log.fatal({ err: errText(e, secrets) }, "keeper failed to start")
  process.exit(1)
}
