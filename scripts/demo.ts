/**
 * Live sponsor demo on Base Sepolia (run `pnpm dev:all --network base-sepolia --cre` first). TEST MONEY.
 *   pnpm demo links                          every Fairtown contract on Basescan
 *   pnpm demo watch [--since <blocks> | --from <block>]   live ticker of onchain events, tagged UNISWAP CCA / CHAINLINK CRE / FAIRTOWN
 *   pnpm demo scene <name> [--speed <n>]     director scene: bergen_cod, diwali_marigold, rose_flight, lagos_cold, ...
 *   pnpm demo signal <kind> <place> <severity> <label...>   CRE W2 forced signal (labelled "(forced)")
 *   pnpm demo fx | reference                 CRE W1 FX (trigger 0) or reference prices (trigger 1)
 *   pnpm demo status                         agents, CRE bridge and director state
 * Never prints keys or RPC URLs.
 */
import { continuousClearingAuctionAbi, disputeResolverAbi, lotFactoryAbi, marketSettlementAbi, signalOracleAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { loadEnv } from "@fairtown/shared/env"
import { fileURLToPath } from "node:url"
import { createPublicClient, http, parseEventLogs, type Address, type Log } from "viem"
import { baseSepolia } from "viem/chains"
import { describe, type Tag } from "./demo-events"

const root = fileURLToPath(new URL("../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const API = `http://127.0.0.1:${env.AGENTS_PORT ?? 8787}`
const BRIDGE = `http://127.0.0.1:${env.CRE_BRIDGE_PORT ?? 8789}`
const EXPLORER = (env.EXPLORER_URL || "https://sepolia.basescan.org").replace(/\/$/, "")
const [cmd, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}
const redact = (m: string) => [env.RPC_URL, env.LOGS_RPC_URL, env.RPC_WS_URL].reduce<string>((o, x) => (x ? o.split(x).join("<redacted>") : o), m)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const COLOR: Record<Tag, string> = { "UNISWAP CCA": "\x1b[35m", "CHAINLINK CRE": "\x1b[34m", FAIRTOWN: "\x1b[32m" }

async function call<T>(url: string, body?: object, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(() => {
    throw new Error(`${url} is not reachable; is \`pnpm dev:all --network base-sepolia --cre\` running?`)
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown }
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${JSON.stringify(json.error ?? json)}`)
  return json
}

const creRun = async (body: object) => {
  if (!env.CRE_BRIDGE_TOKEN) throw new Error("CRE_BRIDGE_TOKEN is unset")
  const r = await call<{ runId: string; state: string }>(`${BRIDGE}/run`, body, env.CRE_BRIDGE_TOKEN)
  console.log(`CRE run ${r.runId} ${r.state}: the simulator runs the workflow and broadcasts through the Base Sepolia forwarder (~20 s). Watch the ticker for the event.`)
}

async function watch() {
  const dep = await loadDeployment("base-sepolia")
  const c = dep.contracts as Record<string, Address>
  const rpc = env.LOGS_RPC_URL || env.RPC_URL
  if (!rpc) throw new Error("RPC_URL is unset")
  const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc, { timeout: 30_000 }) })
  const core = [c.LotFactory, c.MarketSettlement, c.SignalOracle, c.DisputeResolver] as Address[]
  const abi = [...lotFactoryAbi, ...marketSettlementAbi, ...signalOracleAbi, ...disputeResolverAbi, ...continuousClearingAuctionAbi]
  const auctions = new Map<string, bigint>()
  const currencyOfLot = new Map<bigint, string>()
  const symbol = (cur: string) => (cur === c.TestEUR!.toLowerCase() ? "tEUR" : cur === c.TestUSD!.toLowerCase() ? "tUSD" : cur.slice(0, 10))
  const names = new Map<string, string>()
  const refreshNames = async () => {
    for (const a of await call<{ agentId: string; name: string }[]>(`${API}/api/agents`).catch(() => [])) names.set(a.agentId.toLowerCase(), a.name)
  }
  await refreshNames()
  const ctx = {
    name: (a: Address) => names.get(a.toLowerCase()) ?? `${a.slice(0, 8)}…`,
    lotOfAuction: (a: Address) => auctions.get(a.toLowerCase()),
    currencyOfLot: (id: bigint) => currencyOfLot.get(id),
  }
  const getLogs = async (address: Address[], from: bigint, to: bigint) => {
    const out: Log[] = []
    for (let a = from; a <= to; a += 200n) out.push(...(await pub.getLogs({ address, fromBlock: a, toBlock: a + 199n < to ? a + 199n : to })))
    return out
  }
  const learn = (logs: Log[]) => {
    for (const l of parseEventLogs({ abi: lotFactoryAbi, logs, eventName: "LotListed" })) {
      auctions.set(l.args.auction.toLowerCase(), l.args.lotId)
      currencyOfLot.set(l.args.lotId, symbol(l.args.currency.toLowerCase()))
    }
  }

  const head = await pub.getBlockNumber()
  let from = flag("--from") ? BigInt(flag("--from")!) : head - BigInt(flag("--since") ?? "0") + 1n
  // Lots listed in the ~10 minutes before the start (3,000 blocks at Base's ~5 blocks/s), so their bids show too.
  learn(await getLogs([c.LotFactory!], from - 3000n, from - 1n))
  console.log(`Watching Base Sepolia from block ${from} (TEST MONEY). ${auctions.size} recent auction(s) known. Ctrl-C stops.`)
  console.log(`  ${COLOR["UNISWAP CCA"]}UNISWAP CCA\x1b[0m auctions and bids   ${COLOR["CHAINLINK CRE"]}CHAINLINK CRE\x1b[0m workflow reports   ${COLOR.FAIRTOWN}FAIRTOWN\x1b[0m settlement\n`)
  let ticks = 0
  for (;;) {
    try {
      const head = await pub.getBlockNumber()
      const to = head < from + 1999n ? head : from + 1999n // a replay (--from) catches up 2,000 blocks per tick
      if (to >= from) {
        const coreLogs = await getLogs(core, from, to)
        learn(coreLogs)
        const auctionLogs = auctions.size ? await getLogs([...auctions.keys()] as Address[], from, to) : []
        const all = [...coreLogs, ...auctionLogs].sort((x, y) => Number(x.blockNumber! - y.blockNumber!) || x.logIndex! - y.logIndex!)
        for (const e of parseEventLogs({ abi, logs: all, strict: false })) {
          const line = describe({ eventName: e.eventName, args: e.args as Record<string, unknown>, address: e.address }, ctx)
          if (!line) continue
          console.log(`${COLOR[line.tag]}${line.tag.padEnd(13)}\x1b[0m #${e.blockNumber}  ${line.text}\n              ${EXPLORER}/tx/${e.transactionHash}`)
        }
        from = to + 1n
      }
      if (++ticks % 15 === 0) await refreshNames()
    } catch (e) {
      console.error(`  (retrying: ${redact(e instanceof Error ? e.message.split("\n")[0]! : String(e))})`)
    }
    await sleep(from > (await pub.getBlockNumber().catch(() => 0n)) ? 2_000 : 0)
  }
}

async function main() {
  switch (cmd) {
    case "links": {
      const dep = await loadDeployment("base-sepolia")
      console.log(`Base Sepolia (chain ${dep.chainId}), deployed at block ${dep.deployedAtBlock}, commit ${dep.commit}`)
      for (const [k, v] of Object.entries({ ...dep.contracts, ...dep.external })) console.log(`  ${k.padEnd(18)} ${EXPLORER}/address/${v}`)
      return
    }
    case "watch":
      return watch()
    case "scene": {
      const name = rest[0]
      if (!name) throw new Error("Usage: pnpm demo scene <bergen_cod|dallas_return|gpu_night|diwali_marigold|rose_flight|lagos_cold|no_show|full_day> [--speed n]")
      await call(`${API}/api/director/scenario`, { name, speed: Number(flag("--speed") ?? 1) })
      console.log(`Scene ${name} started. Signals go through CRE W2, listings through the CCA factory; watch the ticker and the town.`)
      return
    }
    case "signal": {
      const [kind, place, severity, ...label] = rest
      if (!kind || !place || !severity || !label.length) throw new Error("Usage: pnpm demo signal <weather|festival|demand_dip> <place> <1-5> <label...>")
      const head = await createPublicClient({ chain: baseSepolia, transport: http(env.RPC_URL) }).getBlockNumber()
      return creRun({ workflow: "w2-signals", forceSignals: [{ kind, place, severity: Number(severity), label: label.join(" "), expiresAtBlock: (head + 3000n).toString() }] })
    }
    case "fx":
      return creRun({ workflow: "w1-fx-reference", trigger: 0 })
    case "reference":
      return creRun({ workflow: "w1-fx-reference", trigger: 1 })
    case "status": {
      console.log("agents:  ", JSON.stringify(await call(`${API}/api/health`).catch((e: Error) => e.message)))
      console.log("bridge:  ", JSON.stringify(await call(`${BRIDGE}/health`).catch((e: Error) => e.message)))
      console.log("director:", JSON.stringify(await call(`${API}/api/director/status`).catch((e: Error) => e.message)))
      return
    }
    default:
      console.log("Usage: pnpm demo <links|watch|scene|signal|fx|reference|status>  (see scripts/demo.ts)")
      process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  console.error(`demo: ${redact(e instanceof Error ? e.message : String(e))}`)
  process.exit(1)
})
