import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { RoleTarget } from "./config"

// Provider trace data, e.g. from the 0G Router. Optional everywhere.
export type AiTrace = {
  resKey?: string
  requestId?: string
  provider?: string
  teeVerified?: boolean
  model?: string
  cost?: { amount: string; currency: string } // 0G billing.total_cost (the Router reports "usd", micro-USD, on mainnet)
  trustMode?: string // X-0G-Provider-Trust-Mode we sent
  fallback?: { from: string; reason: string } // answered by the fallback provider, not the primary (D-100)
  raw?: unknown
}

export type FetchLike = typeof fetch

function readTrace(raw: unknown, resKey: string | null): AiTrace | undefined {
  if (raw === undefined && !resKey) return undefined
  const t: AiTrace = {}
  if (resKey) t.resKey = resKey
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>
    if (typeof r.request_id === "string") t.requestId = r.request_id
    if (typeof r.provider === "string") t.provider = r.provider
    if (typeof r.tee_verified === "boolean") t.teeVerified = r.tee_verified
    const bill = r.billing as { total_cost?: unknown; currency?: unknown } | undefined
    if (bill && typeof bill.total_cost === "string") t.cost = { amount: bill.total_cost, currency: typeof bill.currency === "string" ? `${bill.currency} micro` : "neuron" }
    t.raw = raw
  }
  return t
}

// One model per call, so the fetch wrapper can hand trace data back to exactly that call.
export function modelFor(target: RoleTarget, onTrace: (t: AiTrace) => void, baseFetch: FetchLike = fetch) {
  const tracingFetch: FetchLike = async (input, init) => {
    const res = await baseFetch(input, init)
    const resKey = res.headers.get("zg-res-key")
    if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
      try {
        const body = (await res.clone().json()) as { x_0g_trace?: unknown }
        const trace = readTrace(body.x_0g_trace, resKey)
        if (trace) onTrace(target.headers?.["X-0G-Provider-Trust-Mode"] ? { ...trace, trustMode: target.headers["X-0G-Provider-Trust-Mode"] } : trace)
      } catch {
        // non-JSON body: nothing to capture
      }
    } else if (resKey) {
      onTrace({ resKey })
    }
    return res
  }
  const provider = createOpenAICompatible({
    name: `fairtown-${target.role}`,
    baseURL: target.baseURL,
    apiKey: target.apiKey,
    supportsStructuredOutputs: true,
    fetch: tracingFetch,
    transformRequestBody: (body) => ({ ...body, ...target.extraBody }),
    ...(target.headers ? { headers: target.headers } : {}),
  })
  return provider.chatModel(target.model)
}
