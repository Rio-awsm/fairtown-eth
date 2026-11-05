import { withV1, type AiConfig } from "./config"
import type { FetchLike } from "./providers"

export type SttResult = { text: string; provider: string }

export class SttError extends Error {
  readonly code = "stt_unavailable"
}

// STT adapters: webspeech runs in the browser, openai-compatible posts to /audio/transcriptions, none is off.
export async function transcribe(c: AiConfig, audioBase64: string, language: string, f: FetchLike = fetch): Promise<SttResult> {
  if (c.STT_PROVIDER === "webspeech") throw new SttError("STT_PROVIDER=webspeech: transcribe in the browser")
  if (c.STT_PROVIDER === "none") throw new SttError("STT is off (STT_PROVIDER=none)")
  const base = c.STT_BASE_URL ?? c.LLM_BASE_URL
  if (!base || !c.STT_MODEL) throw new SttError("STT_PROVIDER=openai-compatible needs STT_BASE_URL and STT_MODEL")
  const raw = audioBase64.replace(/^data:[^;]+;base64,/, "")
  const form = new FormData()
  form.append("file", new Blob([Buffer.from(raw, "base64")], { type: "audio/webm" }), "audio.webm")
  form.append("model", c.STT_MODEL)
  form.append("language", language.split("-")[0]!)
  const res = await f(`${withV1(base)}/audio/transcriptions`, {
    method: "POST",
    headers: c.LLM_API_KEY ? { authorization: `Bearer ${c.LLM_API_KEY}` } : {},
    body: form,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new SttError(`STT returned HTTP ${res.status}`)
  const body = (await res.json()) as { text?: string }
  return { text: body.text ?? "", provider: `openai-compatible:${c.STT_MODEL}` }
}
