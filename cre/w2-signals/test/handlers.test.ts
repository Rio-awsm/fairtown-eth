import { describe, expect } from "bun:test"
import type { Runtime } from "@chainlink/cre-sdk"
import { EvmMock, HttpActionsMock, REPORT_METADATA_HEADER_LENGTH, newTestRuntime, test } from "@chainlink/cre-sdk/test"
import { bigintToProtoBigInt } from "@chainlink/cre-sdk"
import { decodeAbiParameters, hexToString, toHex, type Hex } from "viem"
import configJson from "../config.json"
import { ConfigSchema, endOfDay, type Config } from "../src/lib"
import { classifyReply, initWorkflow, onCalendarTrigger, onWeatherTrigger } from "../src/workflow"

const BASE_SEPOLIA = 10344971235874465080n
const config: Config = ConfigSchema.parse(configJson)
const NOW = Date.UTC(2026, 10, 6, 7, 55) / 1000
const HEAD = 55_150_000n
const HEAD_TIME = NOW - 2 // chain clock a little behind
type TestRt = Runtime<Config> & { getLogs(): string[] }
type Written = { kind: string; place: string; severity: number; expiresAtBlock: bigint; label: string }
const b32 = (h: Hex) => hexToString(h, { size: 32 })

function weatherBody(stormy: Partial<Record<string, { rain: number; gust: number }>> = {}) {
  return JSON.stringify(
    config.places.map((p) => {
      const s = stormy[p.place] ?? { rain: 1, gust: 30 }
      return {
        daily: { time: ["2026-11-06", "2026-11-07"], precipitation_sum: [0, s.rain], wind_gusts_10m_max: [20, s.gust] },
      }
    }),
  )
}

function harness(body: string, status = 200) {
  const urls: string[] = []
  HttpActionsMock.testInstance().sendRequest = (req) => {
    urls.push(req.url)
    return { statusCode: status, body: Buffer.from(body).toString("base64") }
  }
  const writes: Written[] = []
  const evm = EvmMock.testInstance(BASE_SEPOLIA)
  let headerReads = 0
  evm.headerByNumber = () => {
    headerReads++
    return { header: { blockNumber: bigintToProtoBigInt(HEAD), timestamp: String(HEAD_TIME) } } as never
  }
  evm.writeReport = (req) => {
    const raw = req.report?.rawReport ?? new Uint8Array()
    const [kind, body] = decodeAbiParameters(
      [{ type: "uint8" }, { type: "bytes" }],
      toHex(raw.slice(REPORT_METADATA_HEADER_LENGTH)),
    )
    expect(kind).toBe(2)
    const v = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint64" }, { type: "string" }],
      body,
    )
    writes.push({ kind: b32(v[0]), place: b32(v[1]), severity: v[2], expiresAtBlock: v[3], label: v[4] })
    return {
      txStatus: 2,
      receiverContractExecutionStatus: 0,
      txHash: Buffer.alloc(32, writes.length).toString("base64"),
    } as never
  }
  const rt = newTestRuntime(null, { timeProvider: () => NOW * 1000 })
  rt.config = config
  return { runtime: rt as unknown as TestRt, urls, writes, headerReads: () => headerReads }
}

describe("initWorkflow", () => {
  test("two cron handlers: weather first, calendar second", () => {
    const h = initWorkflow(config)
    const sched = (i: number) => (h[i]!.trigger as unknown as { config: { schedule: string } }).config.schedule
    expect([sched(0), sched(1)]).toEqual([config.weatherSchedule, config.calendarSchedule])
  })
})

describe("onWeatherTrigger", () => {
  test("calm everywhere (today's real forecast): no writes, no chain read, each place logged", () => {
    const { runtime, urls, writes, headerReads } = harness(weatherBody())
    expect(onWeatherTrigger(runtime)).toBe("W2 weather: 0 signals")
    expect(urls).toHaveLength(1)
    expect(writes).toHaveLength(0)
    expect(headerReads()).toBe(0)
    expect(runtime.getLogs().join("\n")).toContain("W2 weather bergen: calm, no signal")
  })

  test("a Bergen storm and Lagos rain become signals with block expiry from the chain head", () => {
    const { runtime, writes } = harness(weatherBody({ bergen: { rain: 5, gust: 82.4 }, lagos: { rain: 45, gust: 20 } }))
    expect(onWeatherTrigger(runtime)).toBe("W2 weather: 2 written, 0 unconfirmed, 0 failed, 0 not sent")
    const expiry = HEAD + BigInt(Math.ceil((endOfDay("2026-11-07") - HEAD_TIME) * 5))
    expect(writes).toEqual([
      { kind: "weather", place: "bergen", severity: 4, expiresAtBlock: expiry, label: "Storm forecast, Bergen" },
      { kind: "weather", place: "lagos", severity: 3, expiresAtBlock: expiry, label: "Heavy rain forecast, Lagos" },
    ])
    const logs = runtime.getLogs().join("\n")
    expect(logs).toContain("source https://api.open-meteo.com/v1/forecast")
    expect(logs).toContain("Open-Meteo 2026-11-07: gusts 82.4 km/h, rain 5 mm")
  })

  test("an API error writes nothing", () => {
    const { runtime, writes } = harness('{"error":true}', 429)
    expect(onWeatherTrigger(runtime)).toBe("W2 weather: 0 signals")
    expect(writes).toHaveLength(0)
    expect(runtime.getLogs().join("\n")).toContain("status HTTP 429")
    expect(runtime.getLogs().join("\n")).toContain("W2 weather bergen: missing, no signal")
  })
})

describe("onCalendarTrigger", () => {
  test("Diwali in 2 days for Mumbai and Pune, then the forced Valentine's signal, labelled forced", () => {
    const { runtime, writes } = harness("unused")
    expect(onCalendarTrigger(runtime)).toBe("W2 calendar: 3 written, 0 unconfirmed, 0 failed, 0 not sent")
    expect(writes.map((w) => [w.kind, w.place, w.severity, w.label])).toEqual([
      ["festival", "mumbai", 4, "Diwali in 2 days"],
      ["festival", "pune", 4, "Diwali in 2 days"],
      ["festival", "nairobi", 4, "Valentine's cargo cutoff (forced)"],
    ])
    expect(writes[0]!.expiresAtBlock).toBe(HEAD + BigInt((endOfDay("2026-11-08") - HEAD_TIME) * 5))
    expect(writes[2]!.expiresAtBlock).toBe(HEAD + BigInt((NOW + 6 * 3600 - HEAD_TIME) * 5))
    const logs = runtime.getLogs().join("\n")
    expect(logs).toMatch(/nairobi sev 4 "Valentine's cargo cutoff \(forced\)" .* FORCED, source config forceSignals/)
    expect(logs).toContain("2 within 7 days of 2026-11-06, 1 forced")
  })

  test("a config label without the suffix still goes out labelled forced", () => {
    const { runtime, writes } = harness("unused")
    runtime.config = {
      ...config,
      calendar: [],
      forceSignals: [{ kind: "weather", place: "bergen", severity: 4, label: "Storm forecast, Bergen", hours: 2 }],
    }
    onCalendarTrigger(runtime)
    expect(writes.map((w) => w.label)).toEqual(["Storm forecast, Bergen (forced)"])
  })

  test("nothing in the window and nothing forced: no chain read, no writes", () => {
    const { runtime, writes, headerReads } = harness("unused")
    runtime.config = { ...config, calendar: [], forceSignals: [] }
    expect(onCalendarTrigger(runtime)).toBe("W2 calendar: 0 signals")
    expect(writes).toHaveLength(0)
    expect(headerReads()).toBe(0)
  })
})

describe("classifyReply", () => {
  test("only an explicit receiver SUCCESS counts as written (D-69)", () => {
    expect(classifyReply({ txStatus: 2, receiverContractExecutionStatus: 0 }).status).toBe("written")
    expect(classifyReply({ txStatus: 2, receiverContractExecutionStatus: 1 }).status).toBe("failed")
    expect(classifyReply({ txStatus: 2 }).status).toBe("unconfirmed")
    expect(classifyReply({ txStatus: 1 }).status).toBe("failed")
  })
})
