import { TownEnvelope } from "@fairtown/shared/protocol"
import { readFile } from "node:fs/promises"
import { basename } from "node:path"

export async function readJsonl(path: string): Promise<TownEnvelope[]> {
  const lines = (await readFile(path, "utf8")).split("\n")
  const out: TownEnvelope[] = []
  lines.forEach((line, i) => {
    if (!line.trim()) return
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      throw new Error(`${basename(path)} line ${i + 1}: not JSON`)
    }
    const r = TownEnvelope.safeParse(raw)
    if (!r.success) throw new Error(`${basename(path)} line ${i + 1}: ${r.error.issues[0]?.message}`)
    out.push(r.data)
  })
  return out
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function replay(
  envs: TownEnvelope[],
  sink: (env: TownEnvelope) => void,
  opts: { speed: number; sleep?: (ms: number) => Promise<void> },
): Promise<number> {
  if (!(opts.speed > 0)) throw new Error("speed must be > 0")
  const sleep = opts.sleep ?? sleepMs
  let prev: number | undefined
  for (const env of envs) {
    if (prev !== undefined && env.ts > prev) await sleep((env.ts - prev) / opts.speed)
    prev = env.ts
    sink(env)
  }
  return envs.length
}
