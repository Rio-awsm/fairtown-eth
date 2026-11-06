/**
 * CRE W1 logic: FX and reference prices -> SignalOracle (S1 4.2, SoT 10, contract 7.7 with ICR-005).
 * Trigger 0 (fxSchedule): Frankfurter v2 USD rates for fxQuotes, median across nodes, one kind 3 report each.
 * Trigger 1 (referenceSchedule): GET /api/reference per pair (D-16), median across nodes, one kind 1 report each.
 * Two handlers keep each execution at most 5 writes (ChainWrite.TargetsLimit = 10). Missing or unparsed values are
 * skipped and logged, zero is never written, and every written value is logged with its source and date.
 * WASM rules: `.result()` instead of await; no Date.now() or randomness in node mode. asOf = DON time (`runtime.now()`).
 */
import {
  ConsensusAggregationByFields,
  CronCapability,
  EVMClient,
  HTTPClient,
  TxStatus,
  bytesToHex,
  getNetwork,
  handler,
  hexToBase64,
  identical,
  median,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk"
import type { Hex } from "viem"
import {
  encodeFxReport,
  encodeReferenceReport,
  formatE8,
  fxUrl,
  parseFrankfurterV2,
  parseReference,
  referenceUrl,
  type Config,
  type Pair,
  type Reference,
} from "./lib"

const HTTP_TIMEOUT = "8s" // HTTPAction max is 10 s
// ReceiverContractExecutionStatus (evm/v1alpha client_pb, SDK 1.23.0; not exported from the SDK entry).
const RECEIVER_SUCCESS = 0
const RECEIVER_REVERTED = 1

// ------------------------------------------------------------------ node mode (runs on every node)

/**
 * One GET. A connection failure makes `.result()` throw in CRE (found in the S1 4.5 bridge run: "connection refused"
 * aborted the whole execution), so it is caught here and reported as status 0: that source is skipped, not the run.
 */
export function getText(node: NodeRuntime<Config>, url: string): { status: number; body: string; error: string } {
  try {
    const resp = new HTTPClient().sendRequest(node, { url, method: "GET", timeout: HTTP_TIMEOUT }).result()
    return {
      status: resp.statusCode,
      body: resp.statusCode === 200 ? new TextDecoder().decode(resp.body) : "",
      error: "",
    }
  } catch (e) {
    return { status: 0, body: "", error: (e instanceof Error ? e.message : String(e)).slice(0, 160) }
  }
}
const httpProblem = (r: { status: number; error: string }) =>
  r.status === 0 ? `unreachable: ${r.error}` : `HTTP ${r.status}`

/** One field per quote (perUsdE8, 0n = missing on this node) plus the dates and skip reasons, for consensus. */
type FxObservation = Record<string, bigint | string>

export function observeFx(node: NodeRuntime<Config>): FxObservation {
  const c = node.config
  const resp = getText(node, fxUrl(c.fxBaseUrl, c.fxQuotes))
  const { rates, skipped } = parseFrankfurterV2(resp.body, c.fxQuotes)
  const obs: FxObservation = {}
  for (const q of c.fxQuotes) obs[q] = 0n
  for (const r of rates) obs[r.quote] = r.perUsdE8
  obs.__dates = rates.map((r) => `${r.quote}=${r.date}`).join(",")
  obs.__skipped = resp.status === 200 ? skipped.map((s) => `${s.key}: ${s.reason}`).join("; ") : httpProblem(resp)
  return obs
}
type RefObservation = {
  perUnit: bigint // 0n = not usable on this node
  currency: string
  date: string
  source: string
  sourceUrl: string
  reason: string
}

export function observeReference(node: NodeRuntime<Config>, pair: Pair): RefObservation {
  const empty = { perUnit: 0n, currency: "", date: "", source: "", sourceUrl: "" }
  const resp = getText(node, referenceUrl(node.config.referenceUrl, pair))
  if (resp.status !== 200) return { ...empty, reason: httpProblem(resp) }
  const r = parseReference(resp.body, pair)
  if (!r.ok) return { ...empty, reason: r.reason }
  const { perUnit, currency, date, source, sourceUrl } = r.ref
  return { perUnit, currency, date, source, sourceUrl, reason: "" }
}

// ------------------------------------------------------------------ DON mode

/**
 * `asOf` for SignalOracle (D-64): DON time in unix seconds. `runtime.now()` is the same on every node and is real time
 * in simulation. Not the cron payload's scheduledExecutionTime: in `cre workflow simulate` (CLI v1.39.0) that is the
 * NEXT slot, up to an hour ahead, and SignalOracle rejected all ten first broadcasts as ReportFromFuture (D-69).
 */
export function asOfNow(runtime: Runtime<Config>): bigint {
  const ms = runtime.now().getTime()
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("runtime.now() gave no usable time")
  return BigInt(Math.floor(ms / 1000))
}

/**
 * written: mined and the receiver reported success. failed: tx failed or the receiver reverted (e.g. a stale report).
 * unconfirmed: mined, but the forwarder reply carried no receiver status, so success is not claimed (the forwarder
 * swallows receiver reverts and the tx itself still succeeds).
 */
export type WriteResult = { key: string; status: "written" | "unconfirmed" | "failed"; txHash: string; detail: string }

function write(runtime: Runtime<Config>, key: string, payload: Hex): WriteResult {
  const c = runtime.config
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: c.chainSelectorName, isTestnet: true })
  if (!network) throw new Error(`unknown chain ${c.chainSelectorName}`)
  const report = runtime
    .report({
      encodedPayload: hexToBase64(payload),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()
  const reply = new EVMClient(network.chainSelector.selector)
    .writeReport(runtime, { receiver: c.signalOracle, report, gasConfig: { gasLimit: c.gasLimit } })
    .result()
  return { key, txHash: reply.txHash ? bytesToHex(reply.txHash) : "", ...classifyReply(reply) }
}

/**
 * Pure: what a forwarder reply proves. Note (D-69): the SDK turns a missing receiver status into 0 (SUCCESS), and the
 * simulator reported success for ten receiver calls that reverted, so "written" here is a claim, not proof. The
 * chain is checked separately (scripts/verify-onchain.ts).
 */
export function classifyReply(reply: {
  txStatus: number
  receiverContractExecutionStatus?: number
  errorMessage?: string
}): Pick<WriteResult, "status" | "detail"> {
  if (reply.txStatus !== TxStatus.SUCCESS) {
    return { status: "failed", detail: `tx status ${reply.txStatus} ${reply.errorMessage ?? ""}`.trim() }
  }
  const rs = reply.receiverContractExecutionStatus
  if (rs === RECEIVER_REVERTED) return { status: "failed", detail: "receiver reverted" }
  if (rs === RECEIVER_SUCCESS) return { status: "written", detail: "written" }
  return { status: "unconfirmed", detail: "mined, receiver status not reported" }
}

/** Trigger 0. The cron payload is not used: asOf comes from DON time (D-69). */
export function onFxTrigger(runtime: Runtime<Config>): string {
  const c = runtime.config
  const asOf = asOfNow(runtime)
  const fields: Record<string, unknown> = { __dates: identical, __skipped: identical }
  for (const quote of c.fxQuotes) fields[quote] = median
  const obs = runtime
    .runInNodeMode(observeFx, ConsensusAggregationByFields<FxObservation>(fields as never))()
    .result()
  runtime.log(`W1 fx: source ${fxUrl(c.fxBaseUrl, c.fxQuotes)} dates [${String(obs.__dates)}] asOf ${asOf}`)
  if (obs.__skipped) runtime.log(`W1 fx skipped: ${String(obs.__skipped)}`)
  const results: WriteResult[] = []
  for (const quote of c.fxQuotes) {
    const perUsdE8 = obs[quote]
    if (typeof perUsdE8 !== "bigint" || perUsdE8 <= 0n) {
      runtime.log(`W1 fx ${quote}: no consensus value, not written`)
      continue
    }
    const res = write(runtime, `fx:${quote}`, encodeFxReport({ quote, perUsdE8 }, asOf))
    runtime.log(`W1 fx ${quote} = ${formatE8(perUsdE8)} per USD (perUsdE8 ${perUsdE8}): ${res.detail} ${res.txHash}`)
    results.push(res)
  }
  return summary("fx", results, c.fxQuotes.length)
}

/** Trigger 1. */
export function onReferenceTrigger(runtime: Runtime<Config>): string {
  const c = runtime.config
  const asOf = asOfNow(runtime)
  const agg = ConsensusAggregationByFields<RefObservation>({
    perUnit: median,
    currency: identical,
    date: identical,
    source: identical,
    sourceUrl: identical,
    reason: identical,
  })
  const results: WriteResult[] = []
  for (const pair of c.pairs) {
    const key = `${pair.commodity}@${pair.market}`
    const o = runtime.runInNodeMode(observeReference, agg)(pair).result()
    if (o.perUnit <= 0n) {
      runtime.log(`W1 ref ${key}: skipped (${o.reason || "no consensus value"})`)
      continue
    }
    const ref: Reference = { ...pair, ...o }
    const res = write(runtime, `ref:${key}`, encodeReferenceReport(ref, asOf))
    runtime.log(
      `W1 ref ${key} = ${o.perUnit} ${o.currency} base units, dated ${o.date}, source "${o.source}" ${o.sourceUrl}: ${res.detail} ${res.txHash}`,
    )
    results.push(res)
  }
  return summary("ref", results, c.pairs.length)
}

function summary(kind: string, results: WriteResult[], wanted: number): string {
  const n = (s: WriteResult["status"]) => results.filter((r) => r.status === s).length
  return `W1 ${kind}: ${n("written")} written, ${n("unconfirmed")} unconfirmed, ${n("failed")} failed, ${wanted - results.length} skipped`
}

// ------------------------------------------------------------------ wiring

export function initWorkflow(config: Config) {
  const cron = new CronCapability()
  return [
    handler(cron.trigger({ schedule: config.fxSchedule }), onFxTrigger),
    handler(cron.trigger({ schedule: config.referenceSchedule }), onReferenceTrigger),
  ]
}
