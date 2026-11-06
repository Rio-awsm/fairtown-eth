import { describe, expect } from "bun:test"
import { EvmMock, HttpActionsMock, REPORT_METADATA_HEADER_LENGTH, newTestRuntime, test } from "@chainlink/cre-sdk/test"
import { decodeAbiParameters, hexToString, toHex, type Hex } from "viem"
import configJson from "../config.json"
import { classifyReply, initWorkflow, onFxTrigger, onReferenceTrigger } from "../src/workflow"
import type { Runtime } from "@chainlink/cre-sdk"
import { ConfigSchema, type Config } from "../src/lib"

/** The SDK's TestRuntime is typed Runtime<unknown>; the handlers take Runtime<Config>. Test-only cast. */
type TestRt = Runtime<Config> & { getLogs(): string[] }

const BASE_SEPOLIA = 10344971235874465080n
const ASOF = 1_793_946_195n // DON time the test runtime reports
// The simulator's cron payload is the NEXT slot (D-69); asOf must ignore it and use runtime.now().
const payload = { scheduledExecutionTime: { seconds: ASOF + 2_000n, nanos: 0 } } as never
const config: Config = ConfigSchema.parse(configJson)

const FX_BODY =
  '[{"date":"2026-11-06","base":"USD","quote":"EUR","rate":0.88903},{"date":"2026-11-06","base":"USD","quote":"INR","rate":94.46},{"date":"2026-11-06","base":"USD","quote":"KES","rate":129.81},{"date":"2026-11-06","base":"USD","quote":"NGN","rate":1346.12},{"date":"2026-11-06","base":"USD","quote":"NOK","rate":9.2745}]'

const REFS: Record<string, unknown> = {
  "cod@bergen": { perUnit: "8300000", currency: "EUR", date: "2026-11-05", source: "illustrative", sourceUrl: "" },
  "tomato@lagos": { perUnit: "380000", currency: "USD", date: "2026-11-05", source: "illustrative", sourceUrl: "" },
  "marigold@mumbai": { perUnit: "950000", currency: "USD", date: "2026-11-05", source: "illustrative", sourceUrl: "" },
  "gpu_hour@any_dc": { perUnit: "2000000", currency: "USD", date: "2026-11-05", source: "illustrative", sourceUrl: "" },
  "truck_capacity@dallas": {
    perUnit: "120000",
    currency: "USD",
    date: "2026-11-05",
    source: "illustrative",
    sourceUrl: "",
  },
}

type Written = { receiver: string; kind: number; body: Hex; gasLimit: string }

/** Fake HTTP (by URL) and fake EVM; records every write as (kind, body) decoded from the signed report. */
function harness(
  http: (url: string) => { statusCode: number; body: string },
  writeStatus = 2,
  receiverStatus: number | undefined = 0,
) {
  const urls: string[] = []
  HttpActionsMock.testInstance().sendRequest = (req) => {
    urls.push(req.url)
    const r = http(req.url)
    return { statusCode: r.statusCode, body: Buffer.from(r.body).toString("base64") }
  }
  const writes: Written[] = []
  EvmMock.testInstance(BASE_SEPOLIA).writeReport = (req) => {
    const raw = req.report?.rawReport ?? new Uint8Array()
    const encoded = toHex(raw.slice(REPORT_METADATA_HEADER_LENGTH))
    const [kind, body] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], encoded)
    writes.push({ receiver: toHex(req.receiver), kind, body, gasLimit: String(req.gasConfig?.gasLimit ?? "") })
    // Plain JSON-shaped reply (works at runtime); the mock's type wants the full protobuf message. Test-only cast.
    return {
      txStatus: writeStatus,
      ...(receiverStatus === undefined ? {} : { receiverContractExecutionStatus: receiverStatus }),
      txHash: Buffer.alloc(32, writes.length).toString("base64"),
    } as never
  }
  const rt = newTestRuntime(null, { timeProvider: () => Number(ASOF) * 1000 + 789 })
  rt.config = config
  const runtime = rt as unknown as TestRt
  return { runtime, urls, writes }
}

const refHttp = (url: string) => {
  const u = new URL(url)
  const key = `${u.searchParams.get("commodity")}@${u.searchParams.get("market")}`
  const r = REFS[key]
  return r
    ? {
        statusCode: 200,
        body: JSON.stringify({
          commodity: u.searchParams.get("commodity"),
          market: u.searchParams.get("market"),
          ...r,
        }),
      }
    : { statusCode: 404, body: "{}" }
}
const b32 = (h: Hex) => hexToString(h, { size: 32 })

describe("initWorkflow", () => {
  test("two cron handlers: FX first, references second", () => {
    const handlers = initWorkflow(config)
    expect(handlers).toHaveLength(2)
    const schedule = (i: number) =>
      (handlers[i]!.trigger as unknown as { config: { schedule: string } }).config.schedule
    expect(schedule(0)).toBe(config.fxSchedule)
    expect(schedule(1)).toBe(config.referenceSchedule)
  })
})

describe("onFxTrigger", () => {
  test("writes one kind 3 report per quote to the SignalOracle, exact values, asOf = scheduled time", () => {
    const { runtime, urls, writes } = harness(() => ({ statusCode: 200, body: FX_BODY }))
    const out = onFxTrigger(runtime)
    expect(out).toBe("W1 fx: 5 written, 0 unconfirmed, 0 failed, 0 skipped")
    expect(urls).toEqual(["https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,NOK,INR,KES,NGN"])
    expect(writes).toHaveLength(5)
    const decoded = writes.map((w) => {
      expect(w.kind).toBe(3)
      expect(w.receiver.toLowerCase()).toBe(config.signalOracle.toLowerCase())
      expect(w.gasLimit).toBe(config.gasLimit)
      const [code, rate, at] = decodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
        w.body,
      )
      expect(at).toBe(ASOF)
      return [b32(code), rate]
    })
    expect(decoded).toEqual([
      ["EUR", 88_903_000n],
      ["NOK", 927_450_000n],
      ["INR", 9_446_000_000n],
      ["KES", 12_981_000_000n],
      ["NGN", 134_612_000_000n],
    ])
    const logs = runtime.getLogs().join("\n")
    expect(logs).toContain("source https://api.frankfurter.dev/v2/rates")
    expect(logs).toContain("EUR=2026-11-06")
    expect(logs).toContain("W1 fx EUR = 0.88903000 per USD")
  })

  test("skips missing quotes and never writes zero", () => {
    const partial = JSON.stringify([
      { date: "2026-11-06", base: "USD", quote: "EUR", rate: 0.889 },
      { date: "2026-11-06", base: "USD", quote: "NOK", rate: 0 },
    ])
    const { runtime, writes } = harness(() => ({ statusCode: 200, body: partial }))
    expect(onFxTrigger(runtime)).toBe("W1 fx: 1 written, 0 unconfirmed, 0 failed, 4 skipped")
    expect(writes).toHaveLength(1)
    const logs = runtime.getLogs().join("\n")
    expect(logs).toContain("NGN: missing from response")
    expect(logs).toContain("W1 fx NOK: no consensus value, not written")
  })

  test("an unreachable FX API writes nothing and says why", () => {
    const { runtime, writes } = harness(() => {
      throw new Error("dial tcp: connection refused")
    })
    expect(onFxTrigger(runtime)).toBe("W1 fx: 0 written, 0 unconfirmed, 0 failed, 5 skipped")
    expect(writes).toHaveLength(0)
    expect(runtime.getLogs().join("\n")).toContain("unreachable: ")
  })

  test("an HTTP error writes nothing", () => {
    const { runtime, writes } = harness(() => ({ statusCode: 429, body: "rate limited" }))
    expect(onFxTrigger(runtime)).toBe("W1 fx: 0 written, 0 unconfirmed, 0 failed, 5 skipped")
    expect(writes).toHaveLength(0)
    expect(runtime.getLogs().join("\n")).toContain("HTTP 429")
  })

  test("a reverted receiver (e.g. a stale report) is reported as failed, not hidden", () => {
    const { runtime, writes } = harness(() => ({ statusCode: 200, body: FX_BODY }), 2, 1)
    expect(onFxTrigger(runtime)).toBe("W1 fx: 0 written, 0 unconfirmed, 5 failed, 0 skipped")
    expect(writes).toHaveLength(5)
  })

  test("asOf is DON time, not the cron payload's next slot (D-69)", () => {
    const { runtime, writes } = harness(() => ({ statusCode: 200, body: FX_BODY }))
    // Through the registered handler, with a simulator-style payload whose scheduled time is the next slot.
    initWorkflow(config)[0]!.fn(runtime as never, payload)
    const [, , at] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      writes[0]!.body,
    )
    expect(at).toBe(ASOF) // seconds, rounded down
  })

  test("a failed tx is failed", () => {
    const { runtime } = harness(() => ({ statusCode: 200, body: FX_BODY }), 1, undefined)
    expect(onFxTrigger(runtime)).toBe("W1 fx: 0 written, 0 unconfirmed, 5 failed, 0 skipped")
  })
})

describe("onReferenceTrigger", () => {
  test("writes one kind 1 report per D-16 pair from /api/reference", () => {
    const { runtime, urls, writes } = harness(refHttp)
    expect(onReferenceTrigger(runtime)).toBe("W1 ref: 5 written, 0 unconfirmed, 0 failed, 0 skipped")
    expect(urls[0]).toBe("http://localhost:8787/api/reference?commodity=cod&market=bergen")
    const rows = writes.map((w) => {
      expect(w.kind).toBe(1)
      const v = decodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint64" },
        ],
        w.body,
      )
      expect(b32(v[4])).toBe("api:2026-11-05")
      expect(v[5]).toBe(ASOF)
      return `${b32(v[0])}@${b32(v[1])}=${v[2]} ${b32(v[3])}`
    })
    expect(rows).toEqual([
      "cod@bergen=8300000 EUR",
      "tomato@lagos=380000 USD",
      "marigold@mumbai=950000 USD",
      "gpu_hour@any_dc=2000000 USD",
      "truck_capacity@dallas=120000 USD",
    ])
    expect(runtime.getLogs().join("\n")).toContain('dated 2026-11-05, source "illustrative"')
  })

  test("an unreachable service skips every pair instead of aborting the run (S1 4.5 finding)", () => {
    const { runtime, writes } = harness(() => {
      throw new Error('Get "http://localhost:8787/api/reference": connection refused')
    })
    expect(onReferenceTrigger(runtime)).toBe("W1 ref: 0 written, 0 unconfirmed, 0 failed, 5 skipped")
    expect(writes).toHaveLength(0)
    expect(runtime.getLogs().join("\n")).toContain("skipped (unreachable: ")
  })

  test("skips a pair the service doesn't know or answers badly, writes the rest", () => {
    const { runtime, writes } = harness((url) =>
      url.includes("tomato")
        ? { statusCode: 404, body: '{"error":"no reference"}' }
        : url.includes("marigold")
          ? { statusCode: 200, body: JSON.stringify({ ...(REFS["marigold@mumbai"] as object), perUnit: "0" }) }
          : refHttp(url),
    )
    expect(onReferenceTrigger(runtime)).toBe("W1 ref: 3 written, 0 unconfirmed, 0 failed, 2 skipped")
    expect(writes).toHaveLength(3)
    const logs = runtime.getLogs().join("\n")
    expect(logs).toContain("W1 ref tomato@lagos: skipped (HTTP 404)")
    expect(logs).toContain("W1 ref marigold@mumbai: skipped (perUnit is zero)")
  })
})

describe("classifyReply", () => {
  test("only an explicit receiver SUCCESS counts as written", () => {
    expect(classifyReply({ txStatus: 2, receiverContractExecutionStatus: 0 }).status).toBe("written")
    expect(classifyReply({ txStatus: 2, receiverContractExecutionStatus: 1 })).toEqual({
      status: "failed",
      detail: "receiver reverted",
    })
    expect(classifyReply({ txStatus: 2 })).toEqual({
      status: "unconfirmed",
      detail: "mined, receiver status not reported",
    })
    expect(classifyReply({ txStatus: 1, errorMessage: "out of gas" })).toEqual({
      status: "failed",
      detail: "tx status 1 out of gas",
    })
    expect(classifyReply({ txStatus: 0 }).status).toBe("failed")
  })
})
