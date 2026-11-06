/**
 * C 2.1 e2e:chainlink on the anvil fork. The CRE bridge runs the real W1 and W2 workflows in the CRE simulator with
 * --broadcast to the fork (project.yaml ${RPC_URL}); W3 is not built (cut, D-119), so the ruling is MOCKED.
 *   W2 forced Diwali  -> DemandSignal on chain -> the signal in the town -> buyers walk
 *   W1 FX, reference  -> FxUpdated, ReferencePriceUpdated -> /api/fx and /api/reference (plaque, floor text) follow
 *   quality dispute   -> POST /api/disputes -> DisputeOpened -> mocked ruling 50% -> DisputeResolved, RulingSettled exact
 * The contested no-show ruling runs in e2e:trust. `pnpm e2e:chainlink`. TEST MONEY.
 */
import { disputeResolverAbi, lotFactoryAbi, marketSettlementAbi, signalOracleAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { fromKey, toKey } from "@fairtown/shared/keys"
import { erc20Abi, parseEventLogs, type AbiEvent, type Address, type Hash, type Log, type TransactionReceipt } from "viem"
import { checkRuling } from "./checks"
import { mockRuling } from "./ruling"
import { API, CRE_BRIDGE_URL, env, RELAY_PORT, Run, startStack } from "./stack"

const run = new Run("e2e-chainlink", "anvil")
console.log("Fairtown e2e:chainlink on anvil (TEST MONEY; CRE simulation, W3 ruling mocked)")
if (!env.CRE_BRIDGE_TOKEN) throw new Error("CRE_BRIDGE_TOKEN is unset")
const dep = await loadDeployment("anvil")
const oracle = dep.contracts.SignalOracle as Address
const settlement = dep.contracts.MarketSettlement as Address
const resolver = dep.contracts.DisputeResolver as Address
const { pub } = await startStack(run, { relay: true, cre: true })
const start = await pub.getBlockNumber()

const ev = (abi: readonly unknown[], name: string) => (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!
const logs = (address: Address, abi: readonly unknown[], name: string, args?: object) =>
  pub.getLogs({ address, event: ev(abi, name), ...(args ? { args } : {}), fromBlock: start, toBlock: "latest" } as never) as Promise<Log[]>
const get = async <T>(url: string) => (await (await fetch(url)).json()) as T
async function post<T>(url: string, body: object, token?: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const json = (await res.json()) as T & { error?: { code: string; message: string } | string }
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${JSON.stringify(json.error ?? json)}`)
  return json
}
const creRun = (body: object) => post<{ runId: string }>(`${CRE_BRIDGE_URL}/run`, body, env.CRE_BRIDGE_TOKEN)
type Envelope = { event: { type: string; agentId?: string; moveTo?: string; label?: string } }
type Snapshot = { signals: { label: string; kind: string; place: string }[]; fx: Record<string, number>; recent: Envelope[] }

// 1. W2: a forced Diwali signal in Mumbai, through the real workflow in the simulator.
const head = await pub.getBlockNumber()
const w2 = await creRun({ workflow: "w2-signals", forceSignals: [{ kind: "festival", place: "mumbai", severity: 4, label: "Diwali", expiresAtBlock: (head + 3000n).toString() }] })
run.say(`..  W2 run ${w2.runId} started (CRE simulation, forced signal)`)
const [signal] = parseEventLogs({
  abi: signalOracleAbi,
  logs: await run.until("DemandSignal", 6 * 60_000, async () => {
    const l = await logs(oracle, signalOracleAbi, "DemandSignal")
    return l.length ? l : undefined
  }, 3_000),
  eventName: "DemandSignal",
})
const s = signal!.args
run.ok([`DemandSignal ${fromKey(s.signalKind)} in ${fromKey(s.place)}, severity ${s.severity}, "${s.label}" (tx ${signal!.transactionHash})`])
if (!s.label.endsWith("(forced)")) throw new Error(`forced signal label must end in "(forced)", got "${s.label}"`)
const snap = await run.until("signal in the town (relay snapshot)", 60_000, async () => {
  const x = await get<Snapshot>(`http://127.0.0.1:${RELAY_PORT}/snapshot`)
  return x.signals.some((g) => g.label === s.label) ? x : undefined
})
run.ok([`the relay carries the signal to the town: "${s.label}"`])
const walkers = await run.until("buyers walking on the signal", 60_000, async () => {
  const x = await get<Snapshot>(`http://127.0.0.1:${RELAY_PORT}/snapshot`)
  const i = x.recent.findIndex((e) => e.event.type === "signal" && e.event.label === s.label)
  const after = (i >= 0 ? x.recent.slice(i + 1) : []).filter((e) => e.event.type === "agent.intent" && e.event.moveTo)
  return after.length > 0 ? new Set(after.map((e) => e.event.agentId)).size : undefined
})
run.ok([`${walkers} agent(s) walked after the signal`])
void snap

// 2. W1: FX (trigger 0, Frankfurter) and reference prices (trigger 1, the agents' /api/reference), on chain.
await creRun({ workflow: "w1-fx-reference", trigger: 0 })
run.say("..  W1 FX run started")
const fxLogs = await run.until("FxUpdated", 6 * 60_000, async () => {
  const l = await logs(oracle, signalOracleAbi, "FxUpdated")
  return l.length ? l : undefined
}, 3_000)
const fx = parseEventLogs({ abi: signalOracleAbi, logs: fxLogs, eventName: "FxUpdated" })
run.ok([`FxUpdated for ${fx.map((f) => fromKey(f.args.currencyCode)).join(", ")}`])
const eur = fx.find((f) => fromKey(f.args.currencyCode) === "EUR")
if (eur) {
  const want = Number(eur.args.perUsdE8) / 1e8
  await run.until("/api/fx follows the chain", 60_000, async () => {
    const r = await get<{ rates: Record<string, number> }>(`${API}/api/fx`)
    return Math.abs((r.rates.EUR ?? 0) - want) < 1e-8 ? true : undefined
  })
  run.ok([`/api/fx EUR = ${want} (from FxUpdated)`])
}
await creRun({ workflow: "w1-fx-reference", trigger: 1 })
run.say("..  W1 reference run started")
const refLogs = await run.until("ReferencePriceUpdated cod@bergen", 6 * 60_000, async () => {
  const l = await logs(oracle, signalOracleAbi, "ReferencePriceUpdated", { commodity: toKey("cod"), market: toKey("bergen") })
  return l.length ? l : undefined
}, 3_000)
const [ref] = parseEventLogs({ abi: signalOracleAbi, logs: refLogs, eventName: "ReferencePriceUpdated" })
const refApi = await run.until("/api/reference follows the chain", 60_000, async () => {
  const r = await get<{ perUnit: string; source: string }>(`${API}/api/reference?commodity=cod&market=bergen`)
  return BigInt(r.perUnit) === ref!.args.perUnit ? r : undefined
})
run.ok([`ReferencePriceUpdated cod@bergen ${ref!.args.perUnit} ${fromKey(ref!.args.currencyCode)}; /api/reference matches (${refApi.source})`])

// 3. Quality dispute from a buyer, then the MOCKED W3 ruling: half refunded.
const d = await post<{ draftId: string }>(`${API}/api/listings/draft`, { sellerId: "ingrid", text: "60 kg cod, Bergen" })
const c = await post<{ lotId: string; tx: Hash }>(`${API}/api/listings/confirm`, { draftId: d.draftId, floorPerUnit: "7500000", durationBlocks: 40 })
const lotId = BigInt(c.lotId)
const [listed] = parseEventLogs({ abi: lotFactoryAbi, logs: (await pub.waitForTransactionReceipt({ hash: c.tx })).logs, eventName: "LotListed" })
const winners = await run.until(`claimed winners of lot ${lotId}`, 5 * 60_000, async () => {
  const v = await get<{ winners?: { buyer: Address; tokenAmount: string }[] }>(`${API}/api/lots/${lotId}`)
  return v.winners?.length ? v.winners : undefined
}, 3_000)
const buyer = winners[0]!
const tokens = BigInt(buyer.tokenAmount) / 2n
const [held, soldTokens] = await pub.readContract({ address: settlement, abi: marketSettlementAbi, functionName: "heldOf", args: [lotId] })
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const photo = { dataUrl: `data:image/png;base64,${png}`, lotCode: String(lotId % 10000n).padStart(4, "0"), capturedAt: new Date().toISOString() }
const { disputeId } = await post<{ disputeId: string }>(`${API}/api/disputes`, { buyerId: buyer.buyer, lotId: c.lotId, tokenAmount: tokens.toString(), photos: [photo] })
const opened = await logs(resolver, disputeResolverAbi, "DisputeOpened", { disputeId: BigInt(disputeId) })
if (!opened.length) throw new Error(`no DisputeOpened for dispute ${disputeId}`)
run.ok([`quality dispute ${disputeId} opened on chain by ${buyer.buyer} for ${tokens} lot tokens`])
const ruling: TransactionReceipt = await mockRuling(pub, resolver, BigInt(disputeId), 5000, "half the cod was not fresh_a")
const [resolved] = parseEventLogs({ abi: disputeResolverAbi, logs: ruling.logs, eventName: "DisputeResolved" })
const [settled] = parseEventLogs({ abi: marketSettlementAbi, logs: ruling.logs, eventName: "RulingSettled" })
const paid = (to: Address) =>
  parseEventLogs({ abi: erc20Abi, logs: ruling.logs, eventName: "Transfer" })
    .filter((t) => t.address.toLowerCase() === listed!.args.currency.toLowerCase() && t.args.from.toLowerCase() === settlement.toLowerCase() && t.args.to.toLowerCase() === to.toLowerCase())
    .reduce((x, t) => x + t.args.value, 0n)
run.ok([`DisputeResolved dispute ${resolved!.args.disputeId}, refund ${resolved!.args.refundBps} bps (MOCKED W3 ruling)`])
run.ok(
  checkRuling({
    heldBefore: held,
    outstanding: soldTokens,
    tokens,
    refundBps: 5000n,
    refundToBuyer: settled!.args.refundToBuyer,
    paidToSeller: settled!.args.paidToSeller,
    sellerTransfer: paid(listed!.args.seller),
    buyerTransfer: paid(buyer.buyer),
  }),
)

run.stop()
console.log(`\nE2E CHAINLINK PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s (W1, W2 real CRE simulations on the fork; W3 ruling mocked)`)
console.log(`  service logs: ${run.runDir}  CRE run logs: cre/logs/bridge/`)
process.exit(0)
