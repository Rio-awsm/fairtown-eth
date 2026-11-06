import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  CreBridge,
  MAX_QUEUE,
  RunBody,
  bridgeConfig,
  buildArgs,
  createBridgeServer,
  eventIndexInTx,
  forcedConfig,
  isPreRunFailure,
  requestFromBody,
  resultLine,
  schedules,
  tokenMatches,
  type BridgeConfig,
  type RunRequest,
} from "../src/creBridge"

const FAKE_CRE = fileURLToPath(new URL("./fixtures/fake-cre.mjs", import.meta.url))
const TOKEN = "test-token-0123456789abcdef"
const SECRET = "https://rpc.example/v2/SECRET_RPC_KEY_42"
const TX = `0x${"ab".repeat(32)}` as const
const DIRECTOR_BODY = {
  workflow: "w2-signals",
  forceSignals: [
    {
      kind: "weather",
      place: "bergen",
      severity: 4,
      label: "Storm forecast, Bergen (forced)",
      expiresAtBlock: "55300000",
    },
  ],
}
const quiet = { info: () => {}, warn: () => {}, error: () => {} }

/** A throwaway repo root with cre/w1-fx-reference and cre/w2-signals "built" (main.ts present). */
function sandbox(over: Partial<BridgeConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), "bridge-"))
  for (const wf of ["w1-fx-reference", "w2-signals"]) {
    mkdirSync(join(root, "cre", wf), { recursive: true })
    writeFileSync(join(root, "cre", wf, "main.ts"), "export async function main() {}\n")
  }
  writeFileSync(
    join(root, "cre", "w2-signals", "config.json"),
    JSON.stringify({
      weatherSchedule: "x",
      calendar: [{ name: "Diwali" }],
      forceSignals: [{ label: "old" }],
      blocksPerSecond: 5,
    }),
  )
  const cfg: BridgeConfig = {
    ...bridgeConfig({ CRE_BRIDGE_TOKEN: TOKEN, CRE_BIN: FAKE_CRE }, root, ""),
    timeoutMs: 5_000,
    ...over,
  }
  const trace = join(root, "trace.txt")
  return { root, cfg, trace }
}
const bridgeFor = (s: ReturnType<typeof sandbox>, env: Record<string, string> = {}) =>
  new CreBridge(
    s.cfg,
    { ...process.env, FAKE_CRE_TRACE: s.trace, FAKE_SECRET: SECRET, FAKE_CRE_ONCE_FILE: join(s.root, "once"), ...env },
    [SECRET, TOKEN],
    quiet,
    undefined,
    undefined,
    10,
  )
const req = (o: Partial<RunRequest> = {}): RunRequest => ({
  workflow: "w1-fx-reference",
  trigger: 0,
  reason: "test",
  ...o,
})

describe("bridgeConfig", () => {
  it("refuses a missing, default or short token without printing it", () => {
    expect(() => bridgeConfig({}, "/r")).toThrow(/CRE_BRIDGE_TOKEN/)
    expect(() => bridgeConfig({ CRE_BRIDGE_TOKEN: "change-me" }, "/r")).toThrow(/change-me/)
    try {
      bridgeConfig({ CRE_BRIDGE_TOKEN: "short-secret" }, "/r")
      expect.unreachable()
    } catch (e) {
      expect(String(e)).not.toContain("short-secret")
    }
  })
  it("defaults: port 8789 on localhost, local-simulation, demo pace 30/60/360 min, broadcast on", () => {
    const c = bridgeConfig({ CRE_BRIDGE_TOKEN: TOKEN }, "/repo", "")
    expect(c).toMatchObject({
      host: "127.0.0.1",
      port: 8789,
      target: "local-simulation",
      creBin: "cre",
      broadcast: true,
    })
    expect(c.minutes).toEqual({ w1: 30, weather: 60, calendar: 360 })
    expect(c.creDir).toBe(join("/repo", "cre"))
  })
  it("reads intervals (0 = off) and rejects bad values", () => {
    const c = bridgeConfig(
      {
        CRE_BRIDGE_TOKEN: TOKEN,
        CRE_BRIDGE_W1_MINUTES: "0",
        CRE_BRIDGE_CALENDAR_MINUTES: "1440",
        CRE_BRIDGE_BROADCAST: "0",
      },
      "/r",
    )
    expect(c.minutes).toEqual({ w1: 0, weather: 60, calendar: 1440 })
    expect(c.broadcast).toBe(false)
    expect(schedules(c).map((s) => s.label)).toEqual(["W2 weather", "W2 calendar"])
    expect(() => bridgeConfig({ CRE_BRIDGE_TOKEN: TOKEN, CRE_BRIDGE_W1_MINUTES: "half" }, "/r")).toThrow(
      /whole minutes/,
    )
    expect(() => bridgeConfig({ CRE_BRIDGE_TOKEN: TOKEN, CRE_TARGET: "x; rm -rf" }, "/r")).toThrow(/CRE_TARGET/)
    expect(() => bridgeConfig({ CRE_BRIDGE_TOKEN: TOKEN, CRE_BRIDGE_TIMEOUT_MS: "5" }, "/r")).toThrow(/TIMEOUT/)
  })
  it("demo pace schedules all four triggers", () => {
    expect(
      schedules(bridgeConfig({ CRE_BRIDGE_TOKEN: TOKEN }, "/r")).map((s) => [s.workflow, s.trigger, s.minutes]),
    ).toEqual([
      ["w1-fx-reference", 0, 30],
      ["w1-fx-reference", 1, 30],
      ["w2-signals", 0, 60],
      ["w2-signals", 1, 360],
    ])
  })
})

describe("requests and arguments", () => {
  it("builds non-interactive simulate commands for timers, W3 and forced runs", () => {
    const cfg = { target: "local-simulation", broadcast: true }
    expect(buildArgs(req({ trigger: 1 }), cfg)).toEqual([
      "workflow",
      "simulate",
      "./w1-fx-reference",
      "--target",
      "local-simulation",
      "--non-interactive",
      "--trigger-index",
      "1",
      "--broadcast",
    ])
    expect(buildArgs(req({ workflow: "w3-rulings", txHash: TX, eventIndex: 2 }), cfg).slice(-4)).toEqual([
      "--evm-tx-hash",
      TX,
      "--evm-event-index",
      "2",
    ])
    expect(buildArgs(req({ workflow: "w2-signals", trigger: 1 }), cfg, "/tmp/c.json").slice(-2)).toEqual([
      "--config",
      "/tmp/c.json",
    ])
    expect(buildArgs(req(), { ...cfg, broadcast: false })).not.toContain("--broadcast")
  })
  it("accepts the agents director's body as is and routes it to W2's calendar trigger", () => {
    const r = requestFromBody(RunBody.parse(DIRECTOR_BODY))
    expect(r).toMatchObject({ workflow: "w2-signals", trigger: 1, forceSignals: DIRECTOR_BODY.forceSignals })
  })
  it("rejects unknown workflows, bad triggers, misplaced fields and junk", () => {
    const bad = (b: unknown) => RunBody.safeParse(b).success
    expect(bad({ workflow: "w9" })).toBe(false)
    expect(bad({ workflow: "w1-fx-reference", trigger: 2 })).toBe(false)
    expect(bad({ workflow: "w1-fx-reference", forceSignals: DIRECTOR_BODY.forceSignals })).toBe(false)
    expect(bad({ workflow: "w3-rulings" })).toBe(false)
    expect(bad({ workflow: "w3-rulings", txHash: TX })).toBe(false)
    expect(bad({ workflow: "w1-fx-reference", txHash: TX, eventIndex: 0 })).toBe(false)
    expect(bad({ workflow: "w1-fx-reference", extra: 1 })).toBe(false)
    expect(
      bad({ ...DIRECTOR_BODY, forceSignals: [{ ...DIRECTOR_BODY.forceSignals[0], expiresAtBlock: 55300000 }] }),
    ).toBe(false)
    expect(bad({ ...DIRECTOR_BODY, forceSignals: [{ ...DIRECTOR_BODY.forceSignals[0], severity: 9 }] })).toBe(false)
    expect(bad({ workflow: "w3-rulings", txHash: TX, eventIndex: 0 })).toBe(true)
    expect(bad({ workflow: "w1-fx-reference", trigger: 1 })).toBe(true)
  })
  it("forced config keeps W2's settings, drops the calendar, carries only the requested signals", () => {
    const out = JSON.parse(
      forcedConfig(
        JSON.stringify({ weatherSchedule: "x", calendar: [{ a: 1 }], forceSignals: [{ b: 2 }] }),
        DIRECTOR_BODY.forceSignals as never,
      ),
    )
    expect(out).toEqual({ weatherSchedule: "x", calendar: [], forceSignals: DIRECTOR_BODY.forceSignals })
  })
  it("finds the workflow's result line and the event index within a transaction", () => {
    expect(
      resultLine('…\n✓ Workflow Simulation Result:\n"W1 fx: 5 written, 0 unconfirmed, 0 failed, 0 skipped"\n'),
    ).toBe("W1 fx: 5 written, 0 unconfirmed, 0 failed, 0 skipped")
    expect(resultLine("Error: boom")).toBeNull()
    expect(eventIndexInTx([{ logIndex: 40 }, { logIndex: 41 }, { logIndex: 42 }], 42)).toBe(2)
    expect(() => eventIndexInTx([{ logIndex: 40 }], 7)).toThrow()
  })
  it("token check is exact and Bearer only", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false)
    expect(tokenMatches(undefined, TOKEN)).toBe(false)
  })
})

describe("CreBridge with a fake cre binary", () => {
  it("runs a workflow, saves a redacted log and records the workflow's result", async () => {
    const s = sandbox()
    const b = bridgeFor(s)
    const rec = b.enqueue(req())!
    await b.whenIdle("w1-fx-reference")
    expect(rec.state).toBe("ok")
    expect(rec.result).toBe("W9 fake: ./w1-fx-reference trigger 0 done")
    const log = readFileSync(rec.logFile!, "utf8")
    expect(log).toContain("# w1-fx-reference trigger 0 (test), SIMULATION")
    expect(log).toContain("--non-interactive --trigger-index 0 --broadcast")
    expect(log).not.toContain("SECRET_RPC_KEY_42")
    expect(log).toContain("<RPC_URL>") // the keeper's shared redact() marker
    expect(log).not.toContain("\x1b[")
    expect(rec.logFile!.startsWith(join(s.root, "cre", "logs", "bridge"))).toBe(true)
  })

  it("with --broadcast, runs take turns across all workflows (one signing key, no nonce clashes)", async () => {
    const s = sandbox()
    const b = bridgeFor(s, { FAKE_CRE_MODE: "slow", FAKE_CRE_SLEEP_MS: "250" })
    b.enqueue(req({ trigger: 0 }))
    b.enqueue(req({ trigger: 1 }))
    b.enqueue(req({ workflow: "w2-signals", trigger: 0 }))
    await Promise.all([b.whenIdle("w1-fx-reference"), b.whenIdle("w2-signals")])
    const ev = readFileSync(s.trace, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split(" "))
    expect(ev.map((e) => e[0])).toEqual(["start", "end", "start", "end", "start", "end"]) // never two at once
  })

  it("dry runs (no --broadcast) of different workflows may overlap; the same workflow never does", async () => {
    const s = sandbox({ broadcast: false })
    const b = bridgeFor(s, { FAKE_CRE_MODE: "slow", FAKE_CRE_SLEEP_MS: "300" })
    b.enqueue(req({ trigger: 0 }))
    b.enqueue(req({ trigger: 1 }))
    b.enqueue(req({ workflow: "w2-signals", trigger: 0 }))
    await Promise.all([b.whenIdle("w1-fx-reference"), b.whenIdle("w2-signals")])
    const ev = readFileSync(s.trace, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split(" "))
    const t = (what: string, wf: string, trig: string) =>
      Number(ev.find((e) => e[0] === what && e[1] === `./${wf}` && e[2] === trig)![3])
    expect(t("start", "w1-fx-reference", "1")).toBeGreaterThanOrEqual(t("end", "w1-fx-reference", "0"))
    expect(t("start", "w2-signals", "0")).toBeLessThan(t("end", "w1-fx-reference", "0"))
  })

  it("does not pile up: a waiting timer run is not queued twice, and the queue is bounded", async () => {
    const s = sandbox()
    const b = bridgeFor(s, { FAKE_CRE_MODE: "slow", FAKE_CRE_SLEEP_MS: "400" })
    expect(b.enqueue(req({ trigger: 0 }))).not.toBeNull() // starts running
    expect(b.enqueue(req({ trigger: 1 }))).not.toBeNull() // waits
    expect(b.enqueue(req({ trigger: 1 }))).toBeNull() // same run already waiting
    const forced = req({ workflow: "w2-signals", trigger: 1, forceSignals: DIRECTOR_BODY.forceSignals as never })
    for (let i = 0; i < MAX_QUEUE + 1; i++) b.enqueue(forced) // 1 runs, MAX_QUEUE wait
    expect(b.enqueue(forced)).toBeNull()
    expect(b.status()["w2-signals"]!.queued).toBe(MAX_QUEUE)
    await Promise.all([b.whenIdle("w1-fx-reference"), b.whenIdle("w2-signals")])
  }, 20_000)

  it("kills a run that passes the timeout and marks it failed", async () => {
    const s = sandbox({ timeoutMs: 200 })
    const b = bridgeFor(s, { FAKE_CRE_MODE: "slow", FAKE_CRE_SLEEP_MS: "3000" })
    const rec = b.enqueue(req())!
    await b.whenIdle("w1-fx-reference")
    expect(rec.state).toBe("failed")
    expect(rec.result).toBe("timed out after 200 ms")
  })

  it("a failing run or one without a result line is failed, with its log kept", async () => {
    const s = sandbox()
    for (const mode of ["fail", "noresult"]) {
      const b = bridgeFor(s, { FAKE_CRE_MODE: mode })
      const rec = b.enqueue(req())!
      await b.whenIdle("w1-fx-reference")
      expect(rec.state).toBe("failed")
      expect(existsSync(rec.logFile!)).toBe(true)
    }
  })

  it("retries once when the CLI's online login check fails before the workflow runs", async () => {
    const s = sandbox()
    const b = bridgeFor(s, { FAKE_CRE_MODE: "authfail-once" })
    const rec = b.enqueue(req())!
    await b.whenIdle("w1-fx-reference")
    expect(rec.state).toBe("ok")
    expect(readFileSync(rec.logFile!, "utf8")).toContain("# retry after a pre-run failure")
    const again = bridgeFor(s, { FAKE_CRE_MODE: "authfail" })
    const r2 = again.enqueue(req())!
    await again.whenIdle("w1-fx-reference")
    expect(r2.state).toBe("failed") // only one retry
  })

  it("never retries a run that already started (writes may have been sent)", () => {
    expect(isPreRunFailure("✓ Workflow compiled\n✗ Credential validation failed")).toBe(false)
    expect(isPreRunFailure("[USER LOG] W1 fx EUR ...\nTLS handshake timeout")).toBe(false)
    expect(isPreRunFailure("Initializing...\n✗ Credential validation failed")).toBe(true)
    expect(isPreRunFailure("Error: simulation failed")).toBe(false)
  })

  it("W3 that is not built yet fails clearly without running cre", async () => {
    const s = sandbox()
    const b = bridgeFor(s)
    const rec = b.enqueue(req({ workflow: "w3-rulings", txHash: TX, eventIndex: 0 }))!
    await b.whenIdle("w3-rulings")
    expect(rec.state).toBe("failed")
    expect(rec.result).toBe("w3-rulings is not built yet")
    expect(existsSync(s.trace)).toBe(false)
  })

  it("forced signals run W2 with a temporary config holding only them, deleted afterwards", async () => {
    const s = sandbox()
    const b = bridgeFor(s)
    const rec = b.enqueue(requestFromBody(RunBody.parse(DIRECTOR_BODY)))!
    await b.whenIdle("w2-signals")
    expect(rec.state).toBe("ok")
    const log = readFileSync(rec.logFile!, "utf8")
    expect(log).toContain("--trigger-index 1")
    expect(log).toMatch(/"calendar": \[\]/)
    expect(log).toContain('"label": "Storm forecast, Bergen (forced)"')
    expect(log).not.toContain('"old"')
    const arg = /--config (\S+)/.exec(log)![1]!
    expect(arg).toMatch(/^\.\/\.forced-[0-9a-f]{8}\.json$/)
    expect(arg.length).toBeLessThanOrEqual(97) // the CLI's limit
    expect(existsSync(join(s.root, "cre", "w2-signals", arg))).toBe(false) // removed after the run
  })
})

describe("HTTP server", () => {
  let close: (() => void) | undefined
  afterEach(() => close?.())

  async function start() {
    const s = sandbox()
    const b = bridgeFor(s)
    const server = createBridgeServer(b, TOKEN)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    close = () => server.close()
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (body: unknown, token: string | null = TOKEN, raw?: string) =>
      fetch(`${url}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: raw ?? JSON.stringify(body),
      })
    return { s, b, url, post }
  }

  it("POST /run needs the token; the director's body is accepted at once (202) and runs", async () => {
    const { b, post } = await start()
    expect((await post(DIRECTOR_BODY, null)).status).toBe(401)
    expect((await post(DIRECTOR_BODY, "wrong-token-0123456789")).status).toBe(401)
    const res = await post(DIRECTOR_BODY)
    expect(res.status).toBe(202)
    const body = (await res.json()) as { runId: string; workflow: string; trigger: number }
    expect(body).toMatchObject({ workflow: "w2-signals", trigger: 1 })
    await b.whenIdle("w2-signals")
    expect(b.history.find((r) => r.id === body.runId)!.state).toBe("ok")
  })

  it("bad JSON, bad bodies, big bodies, wrong method and unknown paths are refused", async () => {
    const { url, post } = await start()
    expect((await post(null, TOKEN, "{not json")).status).toBe(400)
    const bad = await post({ workflow: "w3-rulings" })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(await bad.json())).toContain("txHash")
    expect(
      (await post(null, TOKEN, JSON.stringify({ workflow: "w1-fx-reference", pad: "x".repeat(70_000) }))).status,
    ).toBe(413)
    expect((await fetch(`${url}/run`)).status).toBe(405)
    expect((await fetch(`${url}/nope`)).status).toBe(404)
  })

  it("GET /health needs no token and shows state, never secrets", async () => {
    const { url, post, b } = await start()
    await post({ workflow: "w1-fx-reference" })
    await b.whenIdle("w1-fx-reference")
    const res = await fetch(`${url}/health`)
    expect(res.status).toBe(200)
    const text = await res.text()
    const h = JSON.parse(text) as { simulation: boolean; workflows: Record<string, { built: boolean }> }
    expect(h.simulation).toBe(true)
    expect(h.workflows["w1-fx-reference"]!.built).toBe(true)
    expect(h.workflows["w3-rulings"]!.built).toBe(false)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain("SECRET_RPC_KEY_42")
  })
})

describe("saved logs", () => {
  it("are grouped by day under cre/logs/bridge", async () => {
    const s = sandbox()
    const b = bridgeFor(s)
    b.enqueue(req())
    await b.whenIdle("w1-fx-reference")
    const days = readdirSync(join(s.root, "cre", "logs", "bridge"))
    expect(days).toHaveLength(1)
    expect(days[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
