import { TownEnvelope } from "@fairtown/shared/protocol"

export type JsonlRejection = { line: number; reason: string }

/** Parses relay JSONL (contract 13 `day.jsonl`). Bad lines are reported, never thrown, so a replay keeps going. */
export function parseJsonl(text: string): { envelopes: TownEnvelope[]; rejected: JsonlRejection[] } {
  const envelopes: TownEnvelope[] = []
  const rejected: JsonlRejection[] = []
  text.split("\n").forEach((raw, i) => {
    const line = i + 1
    if (raw.trim() === "") return
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (error: unknown) {
      rejected.push({ line, reason: error instanceof Error ? error.message : "not JSON" })
      return
    }
    const parsed = TownEnvelope.safeParse(json)
    if (parsed.success) envelopes.push(parsed.data)
    else rejected.push({ line, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") })
  })
  return { envelopes, rejected }
}
