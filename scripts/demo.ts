/**
 * Live sponsor demo on Base Sepolia. TEST MONEY.
 *   pnpm demo:day [--minutes 30] [--speed 1] [--pickup 1500] [--keep]   the whole day in one command (starts the stack)
 * The rest need `pnpm dev:all --network base-sepolia --cre` running:
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
import { mkdirSync, writeFileSync } from "node:fs"
import { createPublicClient, http, parseEventLogs, type Address, type Log } from "viem"
import { baseSepolia } from "viem/chains"
import { DAY_DONE, dayOver, describe, renderDayReport, type DayLot, type DirectorRun, type Tag, type TxLine } from "./demo-events"
import { env, RELAY_PORT, root, Run, startStack, WEB_PORT } from "./e2e/stack"

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

/**
 * Polls Base Sepolia from `from` and hands each decoded Fairtown event to `onLine` (with its Basescan tx), until `stop()`.
 * Auctions are learned from LotListed, including lots listed in the 3,000 blocks (~10 min) before `from`.
 */
async function ticker(from: bigint, onLine: (l: TxLine) => void, stop: () => boolean = () => false) {
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
  const getLogs = async (address: Address[], a0: bigint, to: bigint) => {
    const out: Log[] = []
    for (let a = a0; a <= to; a += 200n) out.push(...(await pub.getLogs({ address, fromBlock: a, toBlock: a + 199n < to ? a + 199n : to })))
    return out
  }
  const learn = (logs: Log[]) => {
    for (const l of parseEventLogs({ abi: lotFactoryAbi, logs, eventName: "LotListed" })) {
      auctions.set(l.args.auction.toLowerCase(), l.args.lotId)
      currencyOfLot.set(l.args.lotId, symbol(l.args.currency.toLowerCase()))
    }
  }
  learn(await getLogs([c.LotFactory!], from - 3000n, from - 1n))
  let ticks = 0
  while (!stop()) {
    try {
      const head = await pub.getBlockNumber()
      const to = head < from + 1999n ? head : from + 1999n // a replay (--from) catches up 2,000 blocks per tick
      if (to >= from) {
        const coreLogs = await getLogs(core, from, to)
        learn(coreLogs)
        const auctionLogs = auctions.size ? await getLogs([...auctions.keys()] as Address[], from, to) : []
        const all = [...coreLogs, ...auctionLogs].sort((x, y) => Number(x.blockNumber! - y.blockNumber!) || x.logIndex! - y.logIndex!)
        for (const e of parseEventLogs({ abi, logs: all, strict: false })) {
          const args = e.args as Record<string, unknown>
          const line = describe({ eventName: e.eventName, args, address: e.address }, ctx)
          if (!line) continue
          const lotId = typeof args.lotId === "bigint" ? args.lotId : ctx.lotOfAuction(e.address)
          onLine({ ...line, block: e.blockNumber!, tx: e.transactionHash!, event: e.eventName!, ...(lotId === undefined ? {} : { lotId }) })
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

const print = (l: TxLine) => console.log(`${COLOR[l.tag]}${l.tag.padEnd(13)}\x1b[0m #${l.block}  ${l.text}\n              ${EXPLORER}/tx/${l.tx}`)
const LEGEND = `  ${COLOR["UNISWAP CCA"]}UNISWAP CCA\x1b[0m auctions and bids   ${COLOR["CHAINLINK CRE"]}CHAINLINK CRE\x1b[0m workflow reports   ${COLOR.FAIRTOWN}FAIRTOWN\x1b[0m settlement\n`
const baseSepoliaHead = () => createPublicClient({ chain: baseSepolia, transport: http(env.RPC_URL, { timeout: 30_000 }) }).getBlockNumber()

async function watch() {
  const head = await baseSepoliaHead()
  const from = flag("--from") ? BigInt(flag("--from")!) : head - BigInt(flag("--since") ?? "0") + 1n
  console.log(`Watching Base Sepolia from block ${from} (TEST MONEY). Ctrl-C stops.`)
  console.log(LEGEND)
  await ticker(from, print)
}

/**
 * The whole market day on Base Sepolia, one command: boots the stack (keeper, agents, relay, web, CRE bridge), runs the
 * director's full_day (W2 signals through CRE), then CRE W1 FX and reference prices once every scene started, prints every onchain event with its Basescan link, and ends when every lot reached an end state
 * (or --minutes, or Ctrl-C). Then writes a report of every transaction to .data/demo/. The contracts' report window
 * (3,000 blocks, ~10 min) sets the floor on how long a day takes; pickup windows are shortened (--pickup) to fit.
 */
async function day() {
  const minutes = Number(flag("--minutes") ?? 30)
  const speed = Number(flag("--speed") ?? 1)
  const pickup = flag("--pickup") ?? "1500"
  const keep = rest.includes("--keep")
  const run = new Run("demo-day", "base-sepolia")
  let phase: "boot" | "day" | "done" = "boot"
  let finish: (reason: string) => Promise<void> = async () => {}
  process.removeAllListeners("SIGINT")
  process.on("SIGINT", () => {
    if (phase === "day") return void finish("stopped with Ctrl-C")
    run.stop()
    process.exit(phase === "done" ? 0 : 1)
  })
  console.log(`Fairtown full day on Base Sepolia (TEST MONEY): real transactions, about 18 to 20 minutes. Ctrl-C ends early and still writes the report.`)
  const windows = Object.fromEntries(["FISH", "FLOWERS", "PRODUCE", "TRUCK"].map((k) => [`PICKUP_WINDOW_${k}`, pickup]))
  const { pub } = await startStack(run, { relay: true, web: true, cre: true, env: windows })
  run.say(`ok  town: http://localhost:${WEB_PORT}/town  (pickup windows ${pickup} blocks for this demo)`)
  const startBlock = await pub.getBlockNumber()
  const lines: TxLine[] = []
  let stopped = false
  const listedHere = new Set<string>() // only lots listed in this run count; the snapshot also holds backfilled older lots
  const onLine = (l: TxLine) => {
    lines.push(l)
    if (l.event === "LotListed" && l.lotId !== undefined) listedHere.add(l.lotId.toString())
    print(l)
  }
  void ticker(startBlock, onLine, () => stopped).catch((e: unknown) => run.say(`ticker stopped: ${redact(String(e))}`))
  await call(`${API}/api/director/scenario`, { name: "full_day", speed })
  phase = "day"
  console.log(`\nfull_day started at block ${startBlock}, speed ${speed}\n${LEGEND}`)

  let lots: DayLot[] = []
  finish = async (reason: string) => {
    if (phase !== "day") return
    phase = "done"
    await sleep(6_000) // the ticker's last poll catches the final events
    stopped = true
    const endBlock = await pub.getBlockNumber().catch(() => startBlock)
    const report = renderDayReport({ lines, lots, explorer: EXPLORER, startBlock, endBlock, minutes: (Date.now() - run.started) / 60_000, reason })
    const dir = `${root}.data/demo`
    mkdirSync(dir, { recursive: true })
    const base = `${dir}/day-${new Date().toISOString().replace(/[:.]/g, "-")}`
    writeFileSync(`${base}.md`, report)
    writeFileSync(`${base}.json`, JSON.stringify({ startBlock, endBlock, reason, lots, lines }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2))
    const txs = new Set(lines.map((l) => l.tx)).size
    console.log(`\nDAY ENDED (${reason}): ${txs} Base Sepolia transactions, ${lots.length} lots`)
    for (const l of [...lots].sort((a, b) => Number(BigInt(a.lotId) - BigInt(b.lotId)))) console.log(`  lot ${l.lotId.padStart(3)}  ${l.commodity.padEnd(16)} ${l.status}`)
    console.log(`\nEvery transaction with its Basescan link: ${base}.md`)
    if (keep) return console.log(`Stack still running (--keep). Town: http://localhost:${WEB_PORT}/town. Ctrl-C stops.`)
    run.stop()
    process.exit(0)
  }

  const deadline = Date.now() + minutes * 60_000
  let lastNote = 0
  let w1Sent = false
  while (phase === "day") {
    try {
      const [status, snap] = await Promise.all([
        call<{ running: DirectorRun[] }>(`${API}/api/director/status`),
        call<{ lots: DayLot[] }>(`http://127.0.0.1:${RELAY_PORT}/snapshot`),
      ])
      lots = snap.lots.filter((l) => listedHere.has(l.lotId))
      const scenesStarted = !status.running.some((r) => r.name === "full_day" && r.next !== null)
      if (scenesStarted && !w1Sent) {
        // Chainlink W1 once the director's W2 signals are through (the bridge runs one workflow at a time).
        w1Sent = true
        for (const trigger of [0, 1]) await creRun({ workflow: "w1-fx-reference", trigger }).catch((e: unknown) => run.say(`W1 trigger ${trigger} not started: ${String(e)}`))
      }
      if (dayOver(status.running, lots)) await finish("every lot reached an end state")
      else if (Date.now() > deadline) await finish(`time limit of ${minutes} minutes; ${lots.filter((l) => !DAY_DONE.has(l.status)).length} lot(s) still in progress`)
      else if (Date.now() - lastNote > 60_000) {
        lastNote = Date.now()
        const next = status.running.find((r) => r.name === "full_day")?.next
        const by = new Map<string, number>()
        for (const l of lots) by.set(l.status, (by.get(l.status) ?? 0) + 1)
        run.say(`..  ${next ? `next scene: ${next}; ` : "all scenes started; "}lots: ${[...by].map(([k, v]) => `${v} ${k}`).join(", ") || "none yet"}; ${new Set(lines.map((l) => l.tx)).size} txs so far`)
      }
    } catch (e) {
      run.say(`(status check failed, retrying: ${redact(e instanceof Error ? e.message : String(e))})`)
    }
    await sleep(5_000)
  }
  await new Promise(() => {})
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
    case "day":
      return day()
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
      const head = await baseSepoliaHead()
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
      console.log("Usage: pnpm demo <day|links|watch|scene|signal|fx|reference|status>  (see scripts/demo.ts)")
      process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  console.error(`demo: ${redact(e instanceof Error ? e.message : String(e))}`)
  process.exit(1)
})
