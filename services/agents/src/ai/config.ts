import { z } from "zod"

export const AI_ROLES = ["bidder", "listing", "vision"] as const
export type AiRole = (typeof AI_ROLES)[number]

const jsonObject = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return {}
    try {
      const v = JSON.parse(s)
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      // fall through
    }
    ctx.addIssue({ code: "custom", message: "must be a JSON object" })
    return z.NEVER
  })

export const AiConfig = z.object({
  MOCK_AI: z
    .enum(["0", "1"])
    .default("1")
    .transform((v) => v === "1"),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  BIDDER_MODEL: z.string().optional(),
  LISTING_MODEL: z.string().optional(),
  VISION_BASE_URL: z.string().url().optional(),
  VISION_API_KEY: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  VISION_EXTRA_BODY: jsonObject,
  VISION_TRUST_MODE: z.enum(["standard", "verified", "private"]).optional(), // 0G Router: X-0G-Provider-Trust-Mode floor
  STT_PROVIDER: z.enum(["webspeech", "openai-compatible", "none"]).default("webspeech"),
  STT_BASE_URL: z.string().url().optional(),
  STT_MODEL: z.string().optional(),
  STT_LANGUAGE: z.string().default("en-US"),
  LLM_MAX_RPM: z.coerce.number().int().positive().optional(), // team LiteLLM key: 60
  // Vision fallback when the primary vision provider (0G Router) fails or runs out of credit. Defaults: LLM_* with LISTING_MODEL.
  VISION_FALLBACK_BASE_URL: z.string().url().optional(),
  VISION_FALLBACK_API_KEY: z.string().optional(),
  VISION_FALLBACK_MODEL: z.string().optional(),
  VISION_FALLBACK: z.enum(["0", "1"]).default("1").transform((v) => v === "1"),
})
export type AiConfig = z.infer<typeof AiConfig>

export class AiConfigError extends Error {}

export function parseAiConfig(env: Record<string, string | undefined>): AiConfig {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const r = AiConfig.safeParse(clean)
  if (!r.success) throw new AiConfigError(`Invalid env: ${[...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ")}`)
  const c = r.data
  if (!c.MOCK_AI) {
    const missing = ["LLM_BASE_URL", "BIDDER_MODEL", "LISTING_MODEL", "VISION_MODEL"].filter((k) => !c[k as keyof AiConfig])
    if (missing.length) throw new AiConfigError(`MOCK_AI=0 needs: ${missing.join(", ")}`)
  }
  return c
}

// OpenAI-compatible servers (LiteLLM, Ollama, 0G Router) all serve under /v1.
export const withV1 = (url: string) => {
  const u = url.replace(/\/+$/, "")
  return /\/v1$/.test(u) ? u : `${u}/v1`
}

export type RoleTarget = { role: AiRole; baseURL: string; apiKey?: string; model: string; extraBody: Record<string, unknown>; headers?: Record<string, string> }

// The fallback vision target, if vision has its own provider (e.g. 0G) and a different one to fall back to.
export function visionFallbackFor(c: AiConfig): RoleTarget | undefined {
  if (!c.VISION_FALLBACK || !c.VISION_BASE_URL) return undefined
  const base = c.VISION_FALLBACK_BASE_URL ?? c.LLM_BASE_URL
  const model = c.VISION_FALLBACK_MODEL ?? c.LISTING_MODEL
  if (!base || !model) return undefined
  const fb: RoleTarget = { role: "vision", baseURL: withV1(base), model, extraBody: {} }
  const key = c.VISION_FALLBACK_API_KEY ?? c.LLM_API_KEY
  if (key) fb.apiKey = key
  const primary = targetFor(c, "vision")
  return fb.baseURL === primary.baseURL && fb.model === primary.model ? undefined : fb
}

export function targetFor(c: AiConfig, role: AiRole): RoleTarget {
  if (role === "vision") {
    return {
      role,
      baseURL: withV1(c.VISION_BASE_URL ?? c.LLM_BASE_URL!),
      apiKey: c.VISION_API_KEY ?? c.LLM_API_KEY,
      model: c.VISION_MODEL!,
      extraBody: c.VISION_EXTRA_BODY,
      ...(c.VISION_TRUST_MODE ? { headers: { "X-0G-Provider-Trust-Mode": c.VISION_TRUST_MODE } } : {}),
    }
  }
  return {
    role,
    baseURL: withV1(c.LLM_BASE_URL!),
    apiKey: c.LLM_API_KEY,
    model: role === "bidder" ? c.BIDDER_MODEL! : c.LISTING_MODEL!,
    extraBody: {},
  }
}
