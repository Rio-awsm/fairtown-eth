/**
 * CRE bridge (S1 4.5): runs the CRE workflows through the `cre` simulator during the demo. This is SIMULATION:
 * `cre workflow simulate --broadcast` signs with CRE_ETH_PRIVATE_KEY and sends real Base Sepolia test transactions
 * through the mock forwarder; nothing runs on a CRE network (no deploy access, D-67).
 * - Timers: W1 triggers 0 and 1, W2 trigger 0 (weather) and trigger 1 (calendar), intervals from env (0 = off).
 * - W3: one run per DisputeOpened, with its tx hash and event index (needs cre/w3-rulings, S1 4.4).
 * - POST /run with `Authorization: Bearer <CRE_BRIDGE_TOKEN>`: run a workflow now. The agents director sends
 *   `{ workflow: "w2-signals", forceSignals: [...] }`, which runs W2's calendar trigger with only those signals.
 * - One run at a time per workflow; with --broadcast, one run at a time overall, because every workflow signs with the
 *   same CRE_ETH_PRIVATE_KEY (parallel runs collided: "nonce too low", S1 4.5 live run). Bounded queue, hard timeout,
 *   every run's output saved (redacted).
 */
import { spawn } from "node:child_process"
import { randomUUID, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { join } from "node:path"
import { z } from "zod"
import type { Hex, Log } from "viem"
import { redact, type Env } from "./lib"

export const WORKFLOWS = { "w1-fx-reference": 2, "w2-signals": 2, "w3-rulings": 1 } as const
export type Workflow = keyof typeof WORKFLOWS
export const W2_CALENDAR_TRIGGER = 1
export const MAX_QUEUE = 10
export const MAX_BODY = 64 * 1024
/** Terminal colour codes in cre output (ESC [ ... letter), stripped before logs are saved. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g")

// ------------------------------------------------------------------ config

export type BridgeConfig = {
  host: string
  port: number
  token: string
  target: string
  creBin: string
  creDir: string // repo cre/ folder (the CRE project root)
  logDir: string
  timeoutMs: number
  broadcast: boolean
  minutes: { w1: number; weather: number; calendar: number }
}

const minutes = (env: Env, name: string, fallback: number): number => {
  const raw = env[name]?.trim()
  if (raw === undefined || raw === "") return fallback
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be whole minutes (0 = off)`)
  const n = Number(raw)
  if (n > 7 * 24 * 60) throw new Error(`${name} must be at most one week`)
  return n
}

/** Settings from env. Errors name the variable, never its value. */
export function bridgeConfig(env: Env, root: string, home = env.HOME ?? ""): BridgeConfig {
  const token = env.CRE_BRIDGE_TOKEN?.trim() ?? ""
  if (!token || token === "change-me")
    throw new Error("CRE_BRIDGE_TOKEN is unset or still change-me. Set a long random value in .env")
  if (token.length < 16) throw new Error("CRE_BRIDGE_TOKEN must be at least 16 characters")
  const port = Number(env.CRE_BRIDGE_PORT || 8789)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CRE_BRIDGE_PORT must be a port number")
  const target = env.CRE_TARGET || "local-simulation"
  if (!/^[a-z0-9-]+$/.test(target)) throw new Error("CRE_TARGET must be a target name from cre/project.yaml")
  const localCre = join(home, ".cre", "bin", "cre")
  const timeoutMs = Number(env.CRE_BRIDGE_TIMEOUT_MS || 8 * 60_000) // CRE execution limit 5 min + compile
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000)
    throw new Error("CRE_BRIDGE_TIMEOUT_MS must be at least 10000")
  return {
    host: env.CRE_BRIDGE_HOST || "127.0.0.1",
    port,
    token,
    target,
    creBin: env.CRE_BIN || (home && existsSync(localCre) ? localCre : "cre"),
    creDir: join(root, "cre"),
    logDir: join(root, "cre", "logs", "bridge"),
    timeoutMs,
    broadcast: env.CRE_BRIDGE_BROADCAST !== "0",
    minutes: {
      w1: minutes(env, "CRE_BRIDGE_W1_MINUTES", 30),
      weather: minutes(env, "CRE_BRIDGE_WEATHER_MINUTES", 60),
      calendar: minutes(env, "CRE_BRIDGE_CALENDAR_MINUTES", 360),
    },
  }
}

// ------------------------------------------------------------------ requests

const KEY = /^[a-z0-9_]{1,32}$/
/** The director's forced signal (stream-2-brain `creBridgeSignals`), checked again by W2's own config schema. */
export const ForceSignalInput = z.object({
  kind: z.enum(["weather", "festival", "demand_dip", "reference"]),
  place: z.string().regex(KEY),
  severity: z.number().int().min(1).max(5),
  label: z.string().min(1).max(64),
  expiresAtBlock: z.string().regex(/^[1-9]\d{0,19}$/),
})
export type ForceSignalInput = z.infer<typeof ForceSignalInput>

export const RunBody = z
  .object({
    workflow: z.enum(Object.keys(WORKFLOWS) as [Workflow, ...Workflow[]]),
    trigger: z.number().int().min(0).optional(),
    forceSignals: z.array(ForceSignalInput).min(1).max(10).optional(),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    eventIndex: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.trigger !== undefined && b.trigger >= WORKFLOWS[b.workflow])
      ctx.addIssue({ code: "custom", message: "no such trigger" })
    if (b.forceSignals && b.workflow !== "w2-signals")
      ctx.addIssue({ code: "custom", message: "forceSignals are for w2-signals" })
    const w3 = b.workflow === "w3-rulings"
    if (w3 !== (b.txHash !== undefined && b.eventIndex !== undefined)) {
      ctx.addIssue({ code: "custom", message: "w3-rulings needs txHash and eventIndex, and only it takes them" })
    }
  })
export type RunBody = z.infer<typeof RunBody>

export type RunRequest = {
  workflow: Workflow
  trigger: number
  reason: string
  txHash?: Hex
  eventIndex?: number
  forceSignals?: ForceSignalInput[]
}

export function requestFromBody(b: RunBody): RunRequest {
  return {
    workflow: b.workflow,
    trigger: b.forceSignals ? W2_CALENDAR_TRIGGER : (b.trigger ?? 0),
    reason: b.forceSignals ? "forced signals (POST /run)" : "POST /run",
    ...(b.txHash ? { txHash: b.txHash as Hex, eventIndex: b.eventIndex! } : {}),
    ...(b.forceSignals ? { forceSignals: b.forceSignals } : {}),
  }
}

/** `cre workflow simulate` arguments, always non-interactive. */
export function buildArgs(
  req: RunRequest,
  cfg: Pick<BridgeConfig, "target" | "broadcast">,
  configPath?: string,
): string[] {
  return [
    "workflow",
    "simulate",
    `./${req.workflow}`,
    "--target",
    cfg.target,
    "--non-interactive",
    "--trigger-index",
    String(req.trigger),
    ...(cfg.broadcast ? ["--broadcast"] : []),
    ...(req.txHash !== undefined ? ["--evm-tx-hash", req.txHash, "--evm-event-index", String(req.eventIndex)] : []),
    ...(configPath ? ["--config", configPath] : []),
  ]
}

/** W2 config for a forced run: the real config with no calendar and only the requested signals. */
export function forcedConfig(baseConfig: string, signals: ForceSignalInput[]): string {
  const c = JSON.parse(baseConfig) as Record<string, unknown>
  return `${JSON.stringify({ ...c, calendar: [], forceSignals: signals }, null, 2)}\n`
}

/**
 * Failures before the workflow ran, so nothing was sent and one retry is safe: the CLI checks the login online at
 * every run, and a network blip there fails the run (S1 4.5 live run: "TLS handshake timeout" on credential checks).
 */
export function isPreRunFailure(output: string): boolean {
  if (/Workflow compiled|\[USER LOG\]|Running trigger/.test(output)) return false
  return /Credential validation failed|authentication failed|TLS handshake timeout|i\/o timeout|connection reset/i.test(
    output,
  )
}

export const RETRY_DELAY_MS = 5_000

/** The workflow's own result line, e.g. "W1 fx: 5 written, 0 unconfirmed, 0 failed, 0 skipped". */
export function resultLine(output: string): string | null {
  const m = /"(W\d [a-z]+: [^"]+)"/.exec(output)
  return m ? m[1]! : null
}

// ------------------------------------------------------------------ running

export type RunOutcome = { code: number | null; timedOut: boolean; output: string }
export type Spawner = (
  bin: string,
  args: string[],
  opts: { cwd: string; env: Env; timeoutMs: number },
) => Promise<RunOutcome>

export const spawnCre: Spawner = (bin, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let timedOut = false
    const take = (b: Buffer) => {
      if (output.length < 2_000_000) output += b.toString()
    }
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
    }, opts.timeoutMs)
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: null, timedOut, output: `${output}\nspawn failed: ${e.message}` })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code, timedOut, output })
    })
  })

export type RunRecord = {
  id: string
  workflow: Workflow
  trigger: number
  reason: string
  state: "queued" | "running" | "ok" | "failed"
  result?: string
  logFile?: string
  queuedAt: string
  finishedAt?: string
}

export type BridgeLog = {
  info: (o: object, msg: string) => void
  warn: (o: object, msg: string) => void
  error: (o: object, msg: string) => void
}

/** One run at a time per workflow; with broadcast on, one at a time overall (shared signing key). */
export class CreBridge {
  private readonly queues = new Map<Workflow, RunRecord[]>()
  private readonly running = new Map<Workflow, RunRecord>()
  private readonly requests = new Map<string, RunRequest>()
  private readonly idle = new Map<Workflow, Array<() => void>>()
  readonly history: RunRecord[] = []

  constructor(
    private readonly cfg: BridgeConfig,
    private readonly env: Env,
    private readonly secrets: (string | undefined)[],
    private readonly log: BridgeLog,
    private readonly spawner: Spawner = spawnCre,
    private readonly now: () => Date = () => new Date(),
    private readonly retryDelayMs = RETRY_DELAY_MS,
  ) {}

  exists(workflow: Workflow): boolean {
    return existsSync(join(this.cfg.creDir, workflow, "main.ts"))
  }

  /** Queue a run. Returns null when the workflow's queue is full, or an identical run is already waiting. */
  enqueue(req: RunRequest): RunRecord | null {
    const q = this.queues.get(req.workflow) ?? []
    const plain = !req.txHash && !req.forceSignals
    if (
      plain &&
      q.some(
        (r) => r.trigger === req.trigger && !this.requests.get(r.id)?.txHash && !this.requests.get(r.id)?.forceSignals,
      )
    ) {
      return null // a scheduled run is already waiting; no pile-up
    }
    if (q.length >= MAX_QUEUE) return null
    const rec: RunRecord = {
      id: randomUUID(),
      workflow: req.workflow,
      trigger: req.trigger,
      reason: req.reason,
      state: "queued",
      queuedAt: this.now().toISOString(),
    }
    q.push(rec)
    this.queues.set(req.workflow, q)
    this.requests.set(rec.id, req)
    this.history.push(rec)
    if (this.history.length > 200) this.history.shift()
    void this.pump(req.workflow)
    return rec
  }

  /** Resolves when the workflow has nothing running or queued (tests, shutdown). */
  whenIdle(workflow: Workflow): Promise<void> {
    if (!this.running.has(workflow) && !(this.queues.get(workflow)?.length ?? 0)) return Promise.resolve()
    return new Promise((r) => this.idle.set(workflow, [...(this.idle.get(workflow) ?? []), r]))
  }

  status() {
    return Object.fromEntries(
      (Object.keys(WORKFLOWS) as Workflow[]).map((w) => [
        w,
        {
          built: this.exists(w),
          running: this.running.get(w)?.id ?? null,
          queued: this.queues.get(w)?.length ?? 0,
          last:
            [...this.history].reverse().find((r) => r.workflow === w && (r.state === "ok" || r.state === "failed")) ??
            null,
        },
      ]),
    )
  }

  /** Broadcasting runs share one nonce sequence (CRE_ETH_PRIVATE_KEY): only one may run at a time. */
  private blocked(workflow: Workflow): boolean {
    return this.running.has(workflow) || (this.cfg.broadcast && this.running.size > 0)
  }

  private pumpAll() {
    for (const w of Object.keys(WORKFLOWS) as Workflow[]) void this.pump(w)
  }

  private async pump(workflow: Workflow) {
    if (this.blocked(workflow)) return
    const rec = this.queues.get(workflow)?.shift()
    if (!rec) {
      for (const r of this.idle.get(workflow) ?? []) r()
      this.idle.delete(workflow)
      return
    }
    this.running.set(workflow, rec)
    rec.state = "running"
    try {
      await this.execute(rec, this.requests.get(rec.id)!)
    } catch (e) {
      rec.state = "failed"
      rec.result = `bridge error: ${redact(e instanceof Error ? e.message : String(e), this.live())}`
      this.log.error({ run: rec.id, workflow }, rec.result)
    } finally {
      this.requests.delete(rec.id)
      this.running.delete(workflow)
      rec.finishedAt = this.now().toISOString()
      this.pumpAll()
    }
  }

  private live() {
    return this.secrets.filter((s): s is string => !!s && s.length >= 8)
  }

  private async execute(rec: RunRecord, req: RunRequest) {
    if (!this.exists(req.workflow)) {
      rec.state = "failed"
      rec.result = `${req.workflow} is not built yet`
      this.log.warn({ run: rec.id, workflow: req.workflow }, rec.result)
      return
    }
    // `--config` is resolved from the workflow folder and the CLI caps it at 97 characters, so the temporary config
    // lives next to config.json under a short name (temp-folder paths were too long, S1 4.5 live run).
    let tmp: string | undefined
    let configArg: string | undefined
    if (req.forceSignals) {
      const name = `.forced-${rec.id.slice(0, 8)}.json`
      tmp = join(this.cfg.creDir, req.workflow, name)
      configArg = `./${name}`
      const base = readFileSync(join(this.cfg.creDir, req.workflow, "config.json"), "utf8")
      writeFileSync(tmp, forcedConfig(base, req.forceSignals))
    }
    const args = buildArgs(req, this.cfg, configArg)
    this.log.info(
      { run: rec.id, workflow: req.workflow, trigger: req.trigger, reason: req.reason, broadcast: this.cfg.broadcast },
      "cre run start",
    )
    try {
      const opts = { cwd: this.cfg.creDir, env: this.env, timeoutMs: this.cfg.timeoutMs }
      let out = await this.spawner(this.cfg.creBin, args, opts)
      if (out.code !== 0 && !out.timedOut && isPreRunFailure(out.output)) {
        this.log.warn(
          { run: rec.id, workflow: req.workflow },
          "cre failed before the workflow ran (login or network check), retrying once",
        )
        await new Promise((r) => setTimeout(r, this.retryDelayMs))
        const first = out.output
        out = await this.spawner(this.cfg.creBin, args, opts)
        out = { ...out, output: `${first}\n# retry after a pre-run failure\n${out.output}` }
      }
      const clean = redact(out.output.replace(ANSI, ""), this.live())
      const result = resultLine(clean)
      rec.logFile = this.save(rec, args, clean, out)
      rec.state = out.code === 0 && !out.timedOut && result !== null ? "ok" : "failed"
      rec.result = out.timedOut
        ? `timed out after ${this.cfg.timeoutMs} ms`
        : (result ?? `exit ${out.code}, no result line`)
      this.log[rec.state === "ok" ? "info" : "error"](
        { run: rec.id, workflow: req.workflow, trigger: req.trigger, code: out.code, log: rec.logFile },
        `cre run ${rec.state}: ${rec.result}`,
      )
    } finally {
      if (tmp) rmSync(tmp, { force: true })
    }
  }

  private save(rec: RunRecord, args: string[], output: string, out: RunOutcome): string {
    const day = this.now().toISOString().slice(0, 10)
    const dir = join(this.cfg.logDir, day)
    mkdirSync(dir, { recursive: true })
    const stamp = this.now().toISOString().replace(/[:.]/g, "-")
    const file = join(dir, `${rec.workflow}-t${rec.trigger}-${stamp}-${rec.id.slice(0, 8)}.log`)
    const header = [
      `# ${rec.workflow} trigger ${rec.trigger} (${rec.reason}), SIMULATION`,
      `# cre ${args.join(" ")}`,
      `# exit ${out.code}${out.timedOut ? " (timed out)" : ""}`,
      "",
    ].join("\n")
    writeFileSync(
      file,
      header +
        output
          .split("\n")
          .map((l) => l.trimEnd())
          .filter(Boolean)
          .join("\n") +
        "\n",
    )
    return file
  }
}

// ------------------------------------------------------------------ W3 trigger

/** `--evm-event-index` is the log's position within its transaction's logs (CRE docs), not the block log index. */
export function eventIndexInTx(receiptLogs: Pick<Log, "logIndex">[], logIndex: number): number {
  const i = receiptLogs.findIndex((l) => l.logIndex === logIndex)
  if (i < 0) throw new Error(`log ${logIndex} not in its receipt`)
  return i
}

// ------------------------------------------------------------------ timers

export type Schedule = { workflow: Workflow; trigger: number; minutes: number; label: string }

export function schedules(cfg: Pick<BridgeConfig, "minutes">): Schedule[] {
  return [
    { workflow: "w1-fx-reference" as const, trigger: 0, minutes: cfg.minutes.w1, label: "W1 FX" },
    { workflow: "w1-fx-reference" as const, trigger: 1, minutes: cfg.minutes.w1, label: "W1 reference prices" },
    { workflow: "w2-signals" as const, trigger: 0, minutes: cfg.minutes.weather, label: "W2 weather" },
    { workflow: "w2-signals" as const, trigger: 1, minutes: cfg.minutes.calendar, label: "W2 calendar" },
  ].filter((s) => s.minutes > 0)
}

// ------------------------------------------------------------------ HTTP

function send(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "")
  if (!m) return false
  const a = Buffer.from(m[1]!)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) return null
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** POST /run (token), GET /health (no token, no secrets). Answers at once; the run happens in the background. */
export function createBridgeServer(bridge: CreBridge, token: string): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0]
      if (req.method === "GET" && path === "/health")
        return send(res, 200, { ok: true, simulation: true, workflows: bridge.status() })
      if (path !== "/run") return send(res, 404, { error: "not_found" })
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" })
      if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: "unauthorized" })
      const raw = await readBody(req)
      if (raw === null) return send(res, 413, { error: "body_too_large" })
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        return send(res, 400, { error: "bad_json" })
      }
      const body = RunBody.safeParse(json)
      if (!body.success)
        return send(res, 400, { error: "bad_request", issues: body.error.issues.map((i) => i.message) })
      const rec = bridge.enqueue(requestFromBody(body.data))
      if (!rec) return send(res, 429, { error: "busy", detail: "queue full or the same run is already waiting" })
      return send(res, 202, { runId: rec.id, workflow: rec.workflow, trigger: rec.trigger, state: rec.state })
    })().catch(() => send(res, 500, { error: "internal" }))
  })
}
