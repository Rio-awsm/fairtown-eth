/**
 * CRE bridge entry (S1 4.5): `pnpm -F keeper cre:bridge`. SIMULATION ONLY: runs `cre workflow simulate --broadcast`
 * on timers, on each DisputeOpened (W3), and on POST /run. TEST MONEY on Base Sepolia. Never logs keys, the token or
 * the RPC URL; saved run logs are redacted the same way.
 */
import { fileURLToPath } from "node:url"
import { BaseError, createPublicClient, getAbiItem, http, type Address, type Hex } from "viem"
import { disputeResolverAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { CreBridge, bridgeConfig, createBridgeServer, eventIndexInTx, schedules } from "./creBridge"
import { MIN_LOG_CHUNK } from "./config"
import { loadEnv, shrinkLogChunk } from "./lib"
import { createLogger, errText } from "./log"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
// Placeholders from .env.example are not secrets; redacting them would garble messages that name them.
const PLACEHOLDERS = new Set(["change-me", ""])
const secrets = [
  env.RPC_URL,
  env.FORK_RPC_URL,
  env.CRE_ETH_PRIVATE_KEY,
  env.CRE_BRIDGE_TOKEN,
  env.VISION_API_KEY,
  env.LLM_API_KEY,
  env.AGENT_MNEMONIC,
  env.DEPLOYER_PRIVATE_KEY,
  env.OPERATOR_PRIVATE_KEY,
  env.KEEPER_PRIVATE_KEY,
].filter((v) => v !== undefined && !PLACEHOLDERS.has(v.trim()))
const log = createLogger(secrets)
const DISPUTE_OPENED = getAbiItem({ abi: disputeResolverAbi, name: "DisputeOpened" })

try {
  const cfg = bridgeConfig(env, root)
  // The cre CLI reads CRE_ETH_PRIVATE_KEY, RPC_URL (project.yaml) and VISION_* secrets from the environment.
  const childEnv = { ...process.env, ...env }
  const bridge = new CreBridge(cfg, childEnv, secrets, log)
  const server = createBridgeServer(bridge, cfg.token)
  await new Promise<void>((r) => server.listen(cfg.port, cfg.host, r))
  log.info(
    {
      host: cfg.host,
      port: cfg.port,
      target: cfg.target,
      broadcast: cfg.broadcast,
      minutes: cfg.minutes,
      status: bridge.status(),
    },
    "CRE bridge listening (SIMULATION, TEST MONEY)",
  )

  const timers: NodeJS.Timeout[] = []
  for (const s of schedules(cfg)) {
    const fire = () => {
      const rec = bridge.enqueue({ workflow: s.workflow, trigger: s.trigger, reason: `timer ${s.label}` })
      if (!rec) log.info({ workflow: s.workflow, trigger: s.trigger }, "timer skipped: the same run is already waiting")
    }
    timers.push(setInterval(fire, s.minutes * 60_000))
    fire() // first run at start, then every interval
  }

  // W3: one run per DisputeOpened, polled from the head onward (public RPCs drop filters, D-55).
  const stop = new AbortController()
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => stop.abort())
  if (env.RPC_URL && env.CRE_BRIDGE_W3 !== "0") {
    const dep = await loadDeployment("base-sepolia")
    const resolver = dep.contracts.DisputeResolver as Address
    const pub = createPublicClient({ transport: http(env.RPC_URL, { timeout: 10_000, retryCount: 2 }) })
    let cursor = await pub.getBlockNumber()
    let chunk = 200n
    log.info(
      { resolver, fromBlock: cursor.toString(), built: bridge.exists("w3-rulings") },
      "watching DisputeOpened for W3",
    )
    while (!stop.signal.aborted) {
      try {
        const head = await pub.getBlockNumber({ cacheTime: 0 })
        while (cursor < head) {
          const to = cursor + chunk < head ? cursor + chunk : head
          const logs = await pub.getLogs({
            address: resolver,
            event: DISPUTE_OPENED,
            fromBlock: cursor + 1n,
            toBlock: to,
          })
          for (const l of logs) {
            const receipt = await pub.getTransactionReceipt({ hash: l.transactionHash as Hex })
            const eventIndex = eventIndexInTx(receipt.logs, l.logIndex!)
            const rec = bridge.enqueue({
              workflow: "w3-rulings",
              trigger: 0,
              reason: `DisputeOpened ${l.args.disputeId} (kind ${l.args.kind})`,
              txHash: l.transactionHash as Hex,
              eventIndex,
            })
            log.info(
              { disputeId: String(l.args.disputeId), tx: l.transactionHash, eventIndex, run: rec?.id ?? null },
              "dispute opened, W3 queued",
            )
          }
          cursor = to
        }
      } catch (e) {
        const msg = e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : String(e)
        const next = shrinkLogChunk(msg, chunk, MIN_LOG_CHUNK)
        if (next !== undefined) chunk = next
        else log.warn({ err: errText(e, secrets) }, "dispute watch failed, retrying")
      }
      await new Promise((r) => setTimeout(r, 5_000))
    }
  } else {
    log.warn({}, "dispute watch off (RPC_URL unset or CRE_BRIDGE_W3=0)")
    await new Promise<void>((r) => stop.signal.addEventListener("abort", () => r()))
  }

  for (const t of timers) clearInterval(t)
  server.close()
  log.info({}, "CRE bridge stopped")
} catch (e) {
  log.fatal({ err: errText(e, secrets) }, "CRE bridge failed to start")
  process.exit(1)
}
