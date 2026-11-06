/**
 * CRE W2 logic: demand signals -> SignalOracle kind 2 (S1 4.3, SoT 10, contract 7.7).
 * Trigger 0 (weatherSchedule): Open-Meteo for each place, worst forecast day per place, consensus by fields.
 * Trigger 1 (calendarSchedule): festivals within the window (local calendar, D-14) plus config forceSignals,
 * always labelled "(forced)". Each run writes at most 10 (ChainWrite.TargetsLimit). Expiry blocks come from the chain
 * head (number and timestamp), so no local clock decides when a signal ends.
 * WASM rules: `.result()`, no Date.now() or randomness in node mode; DON time from runtime.now().
 */
import {
  ConsensusAggregationByFields,
  CronCapability,
  EVMClient,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  TxStatus,
  bytesToHex,
  getNetwork,
  handler,
  hexToBase64,
  identical,
  median,
  protoBigIntToBigint,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk"
import type { Hex } from "viem"
import {
  calendarSignals,
  capSignals,
  encodeSignalReport,
  endOfDay,
  expiresAtBlock,
  forcedSignal,
  parseOpenMeteo,
  weatherSignal,
  weatherUrl,
  type Config,
  type DayWeather,
  type Signal,
} from "./lib"

const HTTP_TIMEOUT = "8s"
const RECEIVER_SUCCESS = 0 // ReceiverContractExecutionStatus (evm/v1alpha client_pb, SDK 1.23.0)
const RECEIVER_REVERTED = 1
const DAY = 86_400

// ------------------------------------------------------------------ node mode

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

/**
 * Per place: severity (median), cause and worst day (identical), and that day's gusts and rain in tenths (median).
 * Severity 0 = calm or missing on this node.
 */
type WeatherObservation = Record<string, number | string>

export function observeWeather(node: NodeRuntime<Config>): WeatherObservation {
  const c = node.config
  const resp = getText(node, weatherUrl(c))
  const forecast = resp.status === 200 ? parseOpenMeteo(resp.body, c.places) : new Map<string, DayWeather[]>()
  const obs: WeatherObservation = { __status: resp.status === 200 ? "ok" : httpProblem(resp) }
  for (const p of c.places) {
    const days = forecast.get(p.place)
    const s = days ? weatherSignal(p, days, c, "") : null
    const date = s ? new Date((s.expiresAt - DAY) * 1000).toISOString().slice(0, 10) : ""
    const day = days?.find((d) => d.date === date)
    obs[`${p.place}:sev`] = s?.severity ?? 0
    obs[`${p.place}:cause`] = !days ? "missing" : !s ? "calm" : s.label.startsWith("Storm") ? "wind" : "rain"
    obs[`${p.place}:date`] = date
    obs[`${p.place}:gust10`] = day ? Math.round(day.gustKmh * 10) : 0
    obs[`${p.place}:rain10`] = day ? Math.round(day.rainMm * 10) : 0
  }
  return obs
}

// ------------------------------------------------------------------ DON mode

export function nowSeconds(runtime: Runtime<Config>): number {
  const ms = runtime.now().getTime()
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("runtime.now() gave no usable time")
  return Math.floor(ms / 1000)
}

function evm(runtime: Runtime<Config>) {
  const c = runtime.config
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: c.chainSelectorName, isTestnet: true })
  if (!network) throw new Error(`unknown chain ${c.chainSelectorName}`)
  return new EVMClient(network.chainSelector.selector)
}

/** Latest block number and its timestamp: the clock signal expiry is measured against (SignalOracle compares blocks). */
export function chainHead(runtime: Runtime<Config>): { head: bigint; headTime: number } {
  const reply = evm(runtime).headerByNumber(runtime, { blockNumber: LATEST_BLOCK_NUMBER }).result()
  const h = reply.header
  if (!h?.blockNumber) throw new Error("no latest header")
  return { head: protoBigIntToBigint(h.blockNumber), headTime: Number(h.timestamp) }
}

export type WriteResult = { key: string; status: "written" | "unconfirmed" | "failed"; txHash: string; detail: string }

/** Same rule as W1 (D-69): only an explicit receiver SUCCESS counts; the chain is checked by verify-onchain.ts. */
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

function write(runtime: Runtime<Config>, key: string, payload: Hex): WriteResult {
  const c = runtime.config
  const report = runtime
    .report({
      encodedPayload: hexToBase64(payload),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()
  const reply = evm(runtime)
    .writeReport(runtime, { receiver: c.signalOracle, report, gasConfig: { gasLimit: c.gasLimit } })
    .result()
  return { key, txHash: reply.txHash ? bytesToHex(reply.txHash) : "", ...classifyReply(reply) }
}

/** Writes each signal and logs one parseable line per signal (scripts/verify-onchain.ts reads these). */
function publish(runtime: Runtime<Config>, kind: string, signals: Signal[]): string {
  const c = runtime.config
  const { keep, dropped } = capSignals(signals)
  for (const s of dropped) runtime.log(`W2 ${kind}: over the write limit, not sent: ${s.place} "${s.label}"`)
  if (keep.length === 0) return `W2 ${kind}: 0 signals`
  const { head, headTime } = chainHead(runtime)
  const results: WriteResult[] = []
  for (const s of keep) {
    const block = expiresAtBlock(s, head, headTime, c.blocksPerSecond)
    if (block === null) {
      runtime.log(`W2 ${kind}: already expired by chain time, not sent: ${s.place} "${s.label}"`)
      continue
    }
    const res = write(runtime, `${s.kind}:${s.place}`, encodeSignalReport(s, block))
    runtime.log(
      `W2 signal ${s.kind} ${s.place} sev ${s.severity} "${s.label}" expires block ${block} (${s.expiresBlock !== undefined ? "exact block" : new Date(s.expiresAt * 1000).toISOString()})${s.forced ? " FORCED" : ""}, source ${s.source}: ${res.detail} ${res.txHash}`,
    )
    results.push(res)
  }
  const n = (st: WriteResult["status"]) => results.filter((r) => r.status === st).length
  return `W2 ${kind}: ${n("written")} written, ${n("unconfirmed")} unconfirmed, ${n("failed")} failed, ${signals.length - results.length} not sent`
}

/** Trigger 0. */
export function onWeatherTrigger(runtime: Runtime<Config>): string {
  const c = runtime.config
  const fields: Record<string, unknown> = { __status: identical }
  for (const p of c.places) {
    fields[`${p.place}:sev`] = median
    fields[`${p.place}:cause`] = identical
    fields[`${p.place}:date`] = identical
    fields[`${p.place}:gust10`] = median
    fields[`${p.place}:rain10`] = median
  }
  const obs = runtime
    .runInNodeMode(observeWeather, ConsensusAggregationByFields<WeatherObservation>(fields as never))()
    .result()
  const url = weatherUrl(c)
  runtime.log(`W2 weather: source ${url} status ${String(obs.__status)}`)
  const signals: Signal[] = []
  for (const p of c.places) {
    const sev = Number(obs[`${p.place}:sev`])
    const cause = String(obs[`${p.place}:cause`])
    const gust = Number(obs[`${p.place}:gust10`]) / 10
    const rain = Number(obs[`${p.place}:rain10`]) / 10
    if (sev <= 0 || (cause !== "wind" && cause !== "rain")) {
      runtime.log(`W2 weather ${p.place}: ${cause}, no signal`)
      continue
    }
    const date = String(obs[`${p.place}:date`])
    signals.push({
      kind: "weather",
      place: p.place,
      severity: sev,
      label: `${cause === "wind" ? "Storm forecast" : "Heavy rain forecast"}, ${p.name}`,
      expiresAt: endOfDay(date),
      forced: false,
      source: `Open-Meteo ${date}: gusts ${gust} km/h, rain ${rain} mm`,
    })
  }
  return publish(runtime, "weather", signals)
}

/** Trigger 1: calendar within the window, then forced signals (always labelled). */
export function onCalendarTrigger(runtime: Runtime<Config>): string {
  const c = runtime.config
  const now = nowSeconds(runtime)
  const real = calendarSignals(c.calendar, now, c.calendarWindowDays)
  const forced = c.forceSignals.map((f) => forcedSignal(f, now))
  runtime.log(
    `W2 calendar: ${real.length} within ${c.calendarWindowDays} days of ${new Date(now * 1000).toISOString().slice(0, 10)}, ${forced.length} forced`,
  )
  return publish(runtime, "calendar", [...real, ...forced])
}

export function initWorkflow(config: Config) {
  const cron = new CronCapability()
  return [
    handler(cron.trigger({ schedule: config.weatherSchedule }), onWeatherTrigger),
    handler(cron.trigger({ schedule: config.calendarSchedule }), onCalendarTrigger),
  ]
}
