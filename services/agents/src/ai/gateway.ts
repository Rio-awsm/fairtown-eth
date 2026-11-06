import { APICallError, generateText, Output, type ModelMessage } from "ai"
import pLimit from "p-limit"
import { z } from "zod"
import { AI_ROLES, targetFor, visionFallbackFor, type AiConfig, type AiRole, type RoleTarget } from "./config"
import { FakeAi } from "./fake"
import { modelFor, type AiTrace, type FetchLike } from "./providers"
import { transcribe as sttTranscribe, type SttResult } from "./stt"

export type AiImage = { data: string; mediaType?: string }
export type DecideInput<T> = {
  system: string
  prompt: string
  images?: AiImage[]
  schema: z.ZodType<T>
  timeoutMs?: number
}
export type DecideResult<T> = { value: T; trace?: AiTrace; attempt: 1 | 2 | 3; ms: number }

export type AiErrorCode = "timeout" | "invalid_output" | "provider_error" | "rate_limited" | "mock_error"
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "AiError"
  }
}

// fallbacks: answered on a JSON retry (attempt 2 or 3). switched: answered by the fallback provider (vision, D-79).
type Counters = { calls: number; ok: number; fallbacks: number; failures: number; timeouts: number; switched: number }
const emptyCounters = (): Counters => ({ calls: 0, ok: 0, fallbacks: 0, failures: 0, timeouts: 0, switched: 0 })

export type GatewayOptions = {
  config: AiConfig
  fake?: FakeAi
  fetch?: FetchLike
  concurrency?: number
  defaultTimeoutMs?: number
  maxRpm?: number // overrides LLM_MAX_RPM
  now?: () => number
}

// Provider errors are not "bad JSON": never retry them as such. Status only, because messages can carry URLs or key ids.
const apiError = (role: AiRole, e: unknown) =>
  APICallError.isInstance(e) ? new AiError(e.statusCode === 429 ? "rate_limited" : "provider_error", `${role}: provider HTTP ${e.statusCode ?? "error"}`, e.statusCode) : undefined

// D-79: after a 402 (credits gone) the primary vision provider is skipped for 10 minutes; after 3 failures in a row, 1 minute.
const PAUSE_PAYMENT_MS = 10 * 60_000
const PAUSE_FAILURES_MS = 60_000
const FAILURES_TO_PAUSE = 3
const PRIMARY_MAX_MS = 10_000

const BIDDER_RPM_SHARE = 0.8 // the seller flow (listing, vision) always keeps headroom

export type AiGateway = ReturnType<typeof createGateway>

// D-19: concurrency 4, rules decide after 4s.
export function createGateway(opts: GatewayOptions) {
  const { config } = opts
  const fake = opts.fake ?? new FakeAi()
  const baseFetch = opts.fetch ?? fetch
  const limit = pLimit(opts.concurrency ?? 4)
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 4000
  const maxRpm = opts.maxRpm ?? config.LLM_MAX_RPM
  const now = opts.now ?? Date.now
  const sent: number[] = []

  // One sliding minute for every role, since they share one key. Bidders never wait (rules decide); listing and vision wait.
  async function slot(role: AiRole, signal: AbortSignal) {
    if (!maxRpm) return
    const cap = role === "bidder" ? Math.max(1, Math.floor(maxRpm * BIDDER_RPM_SHARE)) : maxRpm
    for (;;) {
      const t = now()
      while (sent.length && sent[0]! <= t - 60_000) sent.shift()
      if (sent.length < cap) {
        sent.push(t)
        return
      }
      if (role === "bidder") throw new AiError("rate_limited", `bidder: LLM_MAX_RPM budget used`)
      await new Promise((r) => setTimeout(r, Math.min(250, sent[0]! + 60_000 - t)))
      if (signal.aborted) throw signal.reason
    }
  }

  const counters = Object.fromEntries(AI_ROLES.map((r) => [r, emptyCounters()])) as Record<AiRole, Counters>

  async function run<T>(role: AiRole, input: DecideInput<T>, signal: AbortSignal, target?: RoleTarget): Promise<Omit<DecideResult<T>, "ms">> {
    if (config.MOCK_AI) {
      let raw: unknown
      try {
        raw = fake.respond(role, { system: input.system, prompt: input.prompt, images: input.images?.length ?? 0 })
      } catch (e) {
        throw new AiError("mock_error", (e as Error).message)
      }
      const parsed = input.schema.safeParse(raw)
      if (!parsed.success) throw new AiError("invalid_output", `Fake ${role} output failed validation`)
      return { value: parsed.data, attempt: 1 }
    }

    let trace: AiTrace | undefined
    const model = modelFor(target ?? targetFor(config, role), (t) => (trace = t), baseFetch)
    const messages = (prompt: string): ModelMessage[] => [
      { role: "user", content: [{ type: "text", text: prompt }, ...(input.images ?? []).map(toFilePart)] },
    ]

    // 1. Native structured output.
    await slot(role, signal)
    try {
      const r = await generateText({
        model,
        system: input.system,
        messages: messages(input.prompt),
        output: Output.object({ schema: input.schema }),
        abortSignal: signal,
        maxRetries: 0,
      })
      const parsed = input.schema.safeParse(r.output)
      if (parsed.success) return { value: parsed.data, trace, attempt: 1 }
    } catch (e) {
      if (signal.aborted) throw e
      const api = apiError(role, e)
      if (api) throw api
    }

    // 2. Plain JSON with an extractor, then 3. one retry that shows the model its error.
    const jsonSchema = JSON.stringify(z.toJSONSchema(input.schema))
    const ask = `${input.prompt}\n\nRespond with only one JSON object matching this JSON Schema, no prose:\n${jsonSchema}`
    let lastError = "no output"
    for (const attempt of [2, 3] as const) {
      const prompt = attempt === 2 ? ask : `${ask}\n\nYour previous answer was invalid (${lastError}). Return only valid JSON.`
      await slot(role, signal)
      try {
        const r = await generateText({ model, system: input.system, messages: messages(prompt), abortSignal: signal, maxRetries: 0 })
        const parsed = input.schema.safeParse(extractJson(r.text))
        if (parsed.success) return { value: parsed.data, trace, attempt }
        lastError = parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ")
      } catch (e) {
        if (signal.aborted) throw e
        const api = apiError(role, e)
        if (api) throw api
        lastError = (e as Error).message.slice(0, 200)
      }
    }
    throw new AiError("invalid_output", `${role}: no valid output after 3 attempts (${lastError})`)
  }

  const visionFallback = config.MOCK_AI ? undefined : visionFallbackFor(config)
  const pause = { until: 0, reason: "", failures: 0 }

  async function decide<T>(role: AiRole, input: DecideInput<T>): Promise<DecideResult<T>> {
    const c = counters[role]
    c.calls++
    return limit(async () => {
      const started = Date.now()
      const ms = input.timeoutMs ?? defaultTimeoutMs
      const fb = role === "vision" ? visionFallback : undefined
      // With a fallback, the primary gets at most 10 s so a slow 0G answer still leaves the fallback time (D-79).
      const attempt = async (target?: RoleTarget) => {
        const budget = fb && !target ? Math.min(ms, PRIMARY_MAX_MS) : ms
        const signal = AbortSignal.timeout(budget)
        try {
          return await run(role, input, signal, target)
        } catch (e) {
          if (signal.aborted) throw new AiError("timeout", `${role}: timed out after ${budget}ms`)
          throw e instanceof AiError ? e : new AiError("provider_error", `${role}: ${(e as Error).message}`)
        }
      }
      const primary = config.MOCK_AI ? undefined : targetFor(config, role)
      const tag = (t: AiTrace | undefined, target: RoleTarget, extra: Partial<AiTrace> = {}): AiTrace => ({ ...(t ?? {}), model: target.model, ...extra })
      const switchTo = async (reason: string) => {
        const r = await attempt(fb)
        c.ok++
        c.switched++
        return { ...r, trace: tag(r.trace, fb!, { provider: "fallback", fallback: { from: primary!.model, reason } }), ms: Date.now() - started }
      }
      try {
        if (fb && pause.until > now()) return await switchTo(`primary paused: ${pause.reason}`)
        const r = await attempt()
        pause.failures = 0
        c.ok++
        if (r.attempt > 1) c.fallbacks++
        // Vision always says which model graded (the badge needs it); other roles keep the provider's trace as is.
        return { ...r, ...(primary && role === "vision" ? { trace: tag(r.trace, primary) } : {}), ms: Date.now() - started }
      } catch (e) {
        const err = e as AiError
        if (fb && err instanceof AiError && err.code !== "mock_error") {
          if (err.status === 402) Object.assign(pause, { until: now() + PAUSE_PAYMENT_MS, reason: "insufficient balance (HTTP 402)", failures: 0 })
          else if (++pause.failures >= FAILURES_TO_PAUSE) Object.assign(pause, { until: now() + PAUSE_FAILURES_MS, reason: `${pause.failures} failures in a row`, failures: 0 })
          try {
            return await switchTo(err.status ? `primary HTTP ${err.status}` : `primary ${err.code}`)
          } catch {
            // fall through: report the primary's error
          }
        }
        if (err instanceof AiError && err.code === "timeout") c.timeouts++
        else c.failures++
        throw err instanceof AiError ? err : new AiError("provider_error", `${role}: ${(e as Error).message}`)
      }
    })
  }

  function visionStatus() {
    return { fallback: visionFallback ? `${visionFallback.model}` : null, pausedUntil: pause.until > now() ? new Date(pause.until).toISOString() : null, pauseReason: pause.until > now() ? pause.reason : null }
  }

  async function health(): Promise<{ ok: boolean; detail: string }> {
    if (config.MOCK_AI) return { ok: true, detail: "mock" }
    const targets = AI_ROLES.map((r) => targetFor(config, r))
    const models = new Map<string, Set<string>>()
    for (const t of targets) {
      if (models.has(t.baseURL)) continue
      try {
        const res = await baseFetch(`${t.baseURL}/models`, {
          headers: t.apiKey ? { authorization: `Bearer ${t.apiKey}` } : {},
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) return { ok: false, detail: `${t.baseURL}/models returned HTTP ${res.status}` }
        const body = (await res.json()) as { data?: Array<{ id: string }> }
        models.set(t.baseURL, new Set((body.data ?? []).map((m) => m.id)))
      } catch {
        return { ok: false, detail: `${t.baseURL} unreachable` }
      }
    }
    const missing = targets.filter((t) => !models.get(t.baseURL)?.has(t.model)).map((t) => `${t.role}=${t.model}`)
    if (missing.length) return { ok: false, detail: `Models not served: ${missing.join(", ")}` }
    return { ok: true, detail: targets.map((t) => `${t.role}=${t.model}`).join(", ") }
  }

  async function transcribe(audioBase64: string, language = config.STT_LANGUAGE): Promise<SttResult> {
    if (config.MOCK_AI) return { text: fake.transcript, provider: "mock" }
    return sttTranscribe(config, audioBase64, language, baseFetch)
  }

  return { decide, health, transcribe, stats: () => structuredClone(counters), visionStatus, fake }
}

function toFilePart(img: AiImage) {
  const m = img.data.match(/^data:([^;]+);base64,(.*)$/s)
  return m
    ? { type: "file" as const, mediaType: m[1]!, data: m[2]! }
    : { type: "file" as const, mediaType: img.mediaType ?? "image/jpeg", data: img.data }
}

// Pulls the first balanced JSON object out of model text (handles ```json fences and prose).
export function extractJson(text: string): unknown {
  const start = text.indexOf("{")
  if (start === -1) return undefined
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}
