import { existsSync, readFileSync } from "node:fs"
import { parseEnv } from "node:util"
export type Env = Record<string, string | undefined>

const REF = /\$\{([A-Za-z0-9_]+)\}/g
const MAX_PASSES = 8

export function expandEnv(env: Env): Env {
  const out: Env = { ...env }
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false
    for (const [k, v] of Object.entries(out)) {
      if (v === undefined || !v.includes("${")) continue
      out[k] = v.replace(REF, (_, name: string) => (name === k ? "" : (out[name] ?? "")))
      changed = true
    }
    if (!changed) return out
  }
  for (const [k, v] of Object.entries(out)) if (v !== undefined) out[k] = v.replace(REF, "")
  return out
}

export function loadEnv(file: string, shell: Env = process.env): { env: Env; found: boolean } {
  if (!existsSync(file)) return { env: expandEnv({ ...shell }), found: false }
  const fromFile = parseEnv(readFileSync(file, "utf8"))
  return { env: expandEnv({ ...fromFile, ...shell }), found: true }
}
