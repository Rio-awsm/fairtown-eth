import { APICallError, generateText, Output, type ModelMessage } from "ai"
import pLimit from "p-limit"
import { z } from "zod"
import { AI_ROLES, targetFor, type AiConfig, type AiRole } from "./config"
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
  ) {
    super(message)
    this.name = "AiError"
  }
}

type Counters = { calls: number; ok: number; fallbacks: number; failures: number; timeouts: number }
const emptyCounters = (): Counters => ({ calls: 0, ok: 0, fallbacks: 0, failures: 0, timeouts: 0 })

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
  APICallError.isInstance(e) ? new AiError(e.statusCode === 429 ? "rate_limited" : "provider_error", `${role}: provider HTTP ${e.statusCode ?? "error"}`) : undefined

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

  async function run<T>(role: AiRole, input: DecideInput<T>, signal: AbortSignal): Promise<Omit<DecideResult<T>, "ms">> {
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
    const model = modelFor(targetFor(config, role), (t) => (trace = t), baseFetch)
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

  async function decide<T>(role: AiRole, input: DecideInput<T>): Promise<DecideResult<T>> {
    const c = counters[role]
    c.calls++
    return limit(async () => {
      const started = Date.now()
      const ms = input.timeoutMs ?? defaultTimeoutMs
      const signal = AbortSignal.timeout(ms)
      try {
        const r = await run(role, input, signal)
        c.ok++
        if (r.attempt > 1) c.fallbacks++
        return { ...r, ms: Date.now() - started }
      } catch (e) {
        if (signal.aborted) {
          c.timeouts++
          throw new AiError("timeout", `${role}: timed out after ${ms}ms`)
        }
        c.failures++
        throw e instanceof AiError ? e : new AiError("provider_error", `${role}: ${(e as Error).message}`)
      }
    })
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

  return { decide, health, transcribe, stats: () => structuredClone(counters), fake }
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
