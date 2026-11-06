/**
 * C 1.1 e2e: the API lists a lot, agents bid, the keeper settles, money is exact, the price lands on Arkiv.
 *   pnpm e2e:lot                          anvil fork of Base Sepolia, ARKIV_MODE=memory, rule bidders (MOCK_AI=1)
 *   pnpm e2e:lot --network base-sepolia   real chain, live Arkiv (Rabdi), the configured LLM
 * Starts the keeper and the agents service itself; stop your own copies first. Expected values come from chain
 * events only. Never prints keys, the mnemonic or RPC URLs. Service logs go to .data/e2e/<run>/. TEST MONEY.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import { createConnection } from "node:net"
import { fileURLToPath } from "node:url"
import { createPublicClient as createArkivClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { u256 } from "@arkiv-network/sdk/schema"
import { continuousClearingAuctionAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { ARKIV_SDK_SCHEMAS } from "@fairtown/shared/arkiv"
import { loadEnv } from "@fairtown/shared/env"
import {
  createPublicClient,
  createTestClient,
  erc20Abi,
  http,
  parseEventLogs,
  type AbiEvent,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
} from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { anvilArgs, FORK_PORT } from "../chain-fork"
import { checkArkivPrice, checkExits, checkSettlement, type PriceEntity, type Settled } from "./checks"

type Network = "anvil" | "base-sepolia"
const root = fileURLToPath(new URL("../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const network: Network = process.argv.includes("--network")
  ? (process.argv[process.argv.indexOf("--network") + 1] as Network)
  : "anvil"
if (network !== "anvil" && network !== "base-sepolia") throw new Error("Usage: e2e:lot [--network anvil|base-sepolia]")

const ANVIL_URL = `http://127.0.0.1:${FORK_PORT}`
const AGENTS_PORT = Number(env.AGENTS_PORT ?? 8787)
const API = `http://127.0.0.1:${AGENTS_PORT}`
const SELLER_ID = "ingrid" // EUR fish seller in Bergen; three cod buyers (hanse_kitchen, fjord_processing, oslo_fiskehall)
const LISTING = { text: "120 kg cod, Bergen", floorPerUnit: "7500000" } // EUR 7.50 per kg
const DURATION_BLOCKS = network === "anvil" ? 40 : 450 // anvil mines 1 block/s; Base ~5 blocks/s (D-50)
const AGENT_WALLETS = 40 // 27 personas (wallet index = persona order) plus room for walk-in buyers
const LIMIT_MS =network === "anvil" ? 8 * 60_000 : 15 * 60_000
const secrets = [env.RPC_URL, env.RPC_WS_URL, env.LOGS_RPC_URL, env.FORK_RPC_URL, env.ARKIV_ACCESS_KEY]
const runDir = `${root}.data/e2e/lot-${network}-${new Date().toISOString().replace(/[:.]/g, "-")}`
const children: ChildProcess[] = []
const started = Date.now()

const redact = (s: string) => secrets.reduce<string>((out, x) => (x ? out.split(x).join("<redacted>") : out), s)
const say = (msg: string) => console.log(`  ${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s  ${msg}`)
const ok = (lines: string[]) => lines.forEach((l) => say(`ok  ${l}`))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function stopAll() {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM")
}
function fail(e: unknown): never {
  console.error(`\nE2E LOT FAILED: ${redact(e instanceof Error ? e.message : String(e))}`)
  console.error(`Service logs: ${runDir}`)
  stopAll()
  process.exit(1)
}
process.on("unhandledRejection", fail)
process.on("uncaughtException", fail)
process.on("SIGINT", () => fail("interrupted"))

async function until<T>(label: string, ms: number, fn: () => Promise<T | undefined>, everyMs = 2_000): Promise<T> {
  const end = Date.now() + ms
  let last = ""
  for (;;) {
    try {
      const v = await fn()
      if (v !== undefined) return v
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}${last ? ` (last error: ${last})` : ""}`)
    await sleep(everyMs)
  }
}

const portBusy = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" })
    s.once("connect", () => (s.destroy(), resolve(true)))
    s.once("error", () => resolve(false))
  })

function start(name: string, cmd: string, args: string[], extraEnv: Record<string, string>) {
  const log = createWriteStream(`${runDir}/${name}.log`)
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const write = (b: Buffer) => log.write(redact(b.toString()))
  child.stdout!.on("data", write)
  child.stderr!.on("data", write)
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !stopping) fail(`${name} exited with code ${code}; see ${name}.log`)
  })
  children.push(child)
  return child
}
let stopping = false

/** getLogs over [from, to] in chunks (public RPCs cap the range). */
async function logsIn(client: PublicClient, address: Address, event: AbiEvent, from: bigint, to: bigint, args?: object) {
  const chunk = network === "anvil" ? 1_000_000n : 200n // sepolia.base.org: "eth_getLogs is limited to a 200 range"
  const out: Log[] = []
  for (let a = from; a <= to; a += chunk) {
    const b = a + chunk - 1n < to ? a + chunk - 1n : to
    out.push(...(await client.getLogs({ address, event, fromBlock: a, toBlock: b, ...(args ? { args } : {}) } as never)))
  }
  return out
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = (await res.json()) as T & { error?: { code: string; message: string } }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`)
  return json
}

const ev = (abi: readonly unknown[], name: string) =>
  (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!

// ---------------------------------------------------------------------------------------------------------------

mkdirSync(runDir, { recursive: true })
console.log(`Fairtown e2e:lot on ${network} (TEST MONEY)`)
const dep = await loadDeployment(network)
const C = dep.contracts
const settlement = C.MarketSettlement as Address

for (const p of network === "anvil" ? [FORK_PORT, AGENTS_PORT] : [AGENTS_PORT]) {
  if (await portBusy(p)) throw new Error(`port ${p} is in use; stop the running service first`)
}

const rpcUrl = network === "anvil" ? ANVIL_URL : env.RPC_URL
if (!rpcUrl) throw new Error("RPC_URL is unset")
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 30_000 }) }) as PublicClient
const logsClient = (
  network === "base-sepolia" && env.LOGS_RPC_URL
    ? createPublicClient({ chain: baseSepolia, transport: http(env.LOGS_RPC_URL, { timeout: 30_000 }) })
    : pub
) as PublicClient

const services: Record<string, string> =
  network === "anvil"
    ? {
        CHAIN_MODE: "anvil",
        RPC_URL: ANVIL_URL,
        RPC_WS_URL: `ws://127.0.0.1:${FORK_PORT}`,
        LOGS_RPC_URL: ANVIL_URL,
        ANVIL_RPC_URL: ANVIL_URL,
        ARKIV_MODE: "memory",
        MOCK_AI: "1",
        CHAIN_BACKFILL_BLOCKS: "1",
      }
    : { CHAIN_MODE: "base-sepolia", ARKIV_MODE: "live" }

// 1. Chain: an anvil fork (automine while agents bootstrap, then 1 block/s), or Base Sepolia as is.
if (network === "anvil") {
  const fork = anvilArgs(env)
  start("anvil", "anvil", [...fork.args, "--silent"], {})
  await until("anvil", 60_000, async () => ((await pub.getChainId()) === baseSepolia.id ? true : undefined), 500)
  const test = createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(ANVIL_URL) })
  for (const k of ["OPERATOR_PRIVATE_KEY", "KEEPER_PRIVATE_KEY"]) {
    const key = env[k]
    if (!key) throw new Error(`${k} is unset`)
    await test.setBalance({ address: privateKeyToAccount(key as Hash).address, value: 10n ** 19n })
  }
  // Anvil quotes a 1 gwei priority fee (~200x Base Sepolia) and the agents cap fees at 2x, so bootstrap's 0.0005 ETH
  // per agent cannot pay for createLot (~5M gas) on the fork. Gas is set locally, as in the S1 smoke; real balances untouched.
  if (!env.AGENT_MNEMONIC) throw new Error("AGENT_MNEMONIC is unset")
  for (let i = 0; i < AGENT_WALLETS; i++) {
    await test.setBalance({ address: mnemonicToAccount(env.AGENT_MNEMONIC, { addressIndex: i }).address, value: 10n ** 18n })
  }
  say(`ok  anvil fork at block ${await pub.getBlockNumber()}, operator, keeper and ${AGENT_WALLETS} agent wallets funded locally`)
}

// 2. Keeper and agents. Agents bootstrap (register, fund, approve) before the API listens.
start("keeper", "pnpm", ["-s", "-F", "keeper", "exec", "tsx", "src/index.ts", network], services)
start("agents", "pnpm", ["-s", "-F", "agents", "exec", "tsx", "src/index.ts"], services)
const health = await until(
  "agents /api/health",
  network === "anvil" ? 5 * 60_000 : 10 * 60_000,
  async () => api<{ chain: { ok: boolean; detail: string } }>("/api/health"),
  3_000,
)
say(`ok  agents up: ${health.chain.detail}`)
if (network === "anvil") {
  await createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(ANVIL_URL) }).setIntervalMining({
    interval: 1,
  })
  say("ok  anvil now mines 1 block per second")
}

// 3. List through the API: draft, then confirm.
const draft = await api<{ draftId: string }>("/api/listings/draft", { sellerId: SELLER_ID, text: LISTING.text })
const listed = await api<{ lotId: string; auction: Address; token: Address; tx: Hash }>("/api/listings/confirm", {
  draftId: draft.draftId,
  floorPerUnit: LISTING.floorPerUnit,
  durationBlocks: DURATION_BLOCKS,
})
const lotId = BigInt(listed.lotId)
const listReceipt = await pub.waitForTransactionReceipt({ hash: listed.tx })
const [lotEv] = parseEventLogs({ abi: lotFactoryAbi, logs: listReceipt.logs, eventName: "LotListed" })
if (!lotEv) throw new Error("confirm tx has no LotListed event")
const { seller, currency, sector, endBlock, qty } = lotEv.args
const expectedAdvanceBps = BigInt(
  await pub.readContract({
    address: settlement,
    abi: marketSettlementAbi,
    functionName: "advanceBpsFor",
    args: [seller, sector],
    blockNumber: listReceipt.blockNumber,
  }),
)
say(`ok  lot ${lotId} listed: ${qty} kg cod, auction ${listed.auction}, ends at block ${endBlock}`)

// 4. Agents bid, the keeper settles: wait for LotSettled.
const settledEv = ev(marketSettlementAbi, "LotSettled")
const settledLog = await until("LotSettled", LIMIT_MS, async () => {
  const head = await pub.getBlockNumber()
  if (head < endBlock) return undefined
  const [log] = await logsIn(logsClient, settlement, settledEv, listReceipt.blockNumber, head, { lotId })
  return log
})
const [settledParsed] = parseEventLogs({ abi: marketSettlementAbi, logs: [settledLog], eventName: "LotSettled" })
const a = settledParsed!.args
const settled: Settled = {
  lotId: a.lotId,
  finalClearingPerUnit: a.finalClearingPerUnit,
  avgPerUnit: a.avgPerUnit,
  soldUnits: a.soldUnits,
  raised: a.raised,
  sellerPaid: a.sellerPaid,
  held: a.held,
  fee: a.fee,
  advanceBps: Number(a.advanceBps),
}
const settleTx = settledLog.transactionHash!
const settleReceipt = await pub.getTransactionReceipt({ hash: settleTx })
say(`ok  settled in block ${settleReceipt.blockNumber}: final ${a.finalClearingPerUnit}, average ${a.avgPerUnit}`)

// 5. Money is exact: tier advance, fee and held from splitPayout; the settle tx moved exactly that.
const at = { blockNumber: settleReceipt.blockNumber } as const
const [heldOnChain] = await pub.readContract({
  address: settlement,
  abi: marketSettlementAbi,
  functionName: "heldOf",
  args: [lotId],
  ...at,
})
const treasury = await pub.readContract({ address: settlement, abi: marketSettlementAbi, functionName: "treasury", ...at })
const feeBps = BigInt(await pub.readContract({ address: settlement, abi: marketSettlementAbi, functionName: "feeBps", ...at }))
const transfers = parseEventLogs({ abi: erc20Abi, logs: settleReceipt.logs, eventName: "Transfer" }).map((t) => ({
  token: t.address,
  from: t.args.from,
  to: t.args.to,
  value: t.args.value,
}))
ok(checkSettlement(settled, { feeBps, expectedAdvanceBps, heldOnChain, transfers, currency, settlement, seller, treasury }))

// 6. The keeper exits every bid and claims every filled one.
const bidSubmitted = ev(continuousClearingAuctionAbi, "BidSubmitted")
const bidExited = ev(continuousClearingAuctionAbi, "BidExited")
const tokensClaimed = ev(continuousClearingAuctionAbi, "TokensClaimed")
const exitLines = await until("exits and claims", 4 * 60_000, async () => {
  const head = await pub.getBlockNumber()
  const from = listReceipt.blockNumber
  const parse = async (event: AbiEvent) =>
    parseEventLogs({ abi: continuousClearingAuctionAbi, logs: await logsIn(logsClient, listed.auction, event, from, head) })
  const bids = (await parse(bidSubmitted)).flatMap((l) => (l.eventName === "BidSubmitted" ? [l.args.id] : []))
  const exits = (await parse(bidExited)).flatMap((l) =>
    l.eventName === "BidExited" ? [{ bidId: l.args.bidId, tokensFilled: l.args.tokensFilled }] : [],
  )
  const claims = (await parse(tokensClaimed)).flatMap((l) => (l.eventName === "TokensClaimed" ? [l.args.bidId] : []))
  try {
    return checkExits(bids, exits, claims)
  } catch {
    return undefined
  }
}, 3_000)
ok(exitLines)

// 7. Arkiv: the price entity on live Rabdi (base-sepolia only; the anvil run keeps Arkiv in memory, D-114).
if (network === "base-sepolia") {
  if (!env.ARKIV_ACCESS_KEY) throw new Error("ARKIV_ACCESS_KEY is unset")
  const reader = createArkivClient({ chain: rabdi({ accessKey: env.ARKIV_ACCESS_KEY }), transport: http() })
  const cols = { $key: true, lotId: true, finalClearingPerUnit: true, avgPerUnit: true, soldUnits: true, tx: true } as const
  // The SDK returns typed values: { type: "u256", value: 4n }.
  const raw = (v: unknown) => (v !== null && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v)
  const big = (v: unknown) => BigInt(String(raw(v)))
  let key = ""
  const lines = await until("Arkiv price entity", 3 * 60_000, async () => {
    const { entities } = await (reader.select(cols as never) as never as { from: (s: unknown) => { where: (e: unknown) => { limit: (n: number) => { fetch: () => Promise<{ entities: Record<string, unknown>[] }> } } } })
      .from(ARKIV_SDK_SCHEMAS.price)
      .where(eq("lotId", u256(lotId)))
      .limit(20)
      .fetch()
    const found: PriceEntity[] = entities.map((e) => ({
      lotId: big(e.lotId),
      finalClearingPerUnit: big(e.finalClearingPerUnit),
      avgPerUnit: big(e.avgPerUnit),
      soldUnits: big(e.soldUnits),
      tx: String(raw(e.tx)),
    }))
    const hit = entities.find((e) => String(raw(e.tx)).toLowerCase() === settleTx.toLowerCase())
    if (!hit) return undefined
    key = String(hit.$key)
    return checkArkivPrice(found, settled, settleTx)
  }, 5_000)
  ok(lines)
  say(`    Arkiv entity: https://rabdi.explorer.arkiv.network/entity/${key}`)
}

stopping = true
stopAll()
const explorer = (env.EXPLORER_URL || "https://sepolia.basescan.org").replace(/\/$/, "")
console.log(`\nE2E LOT PASSED on ${network} in ${((Date.now() - started) / 1000).toFixed(0)}s`)
if (network === "base-sepolia") {
  console.log(`  auction: ${explorer}/address/${listed.auction}`)
  console.log(`  listed:  ${explorer}/tx/${listed.tx}`)
  console.log(`  settled: ${explorer}/tx/${settleTx}`)
}
console.log(`  service logs: ${runDir}`)
process.exit(0)
