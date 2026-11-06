import { createServer } from "node:net"
import type { Check, Env, Result } from "../core"

export const RABDI_PUBLIC_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network/"
const RABDI_CHAIN_ID_HEX = "0x76edaf"
const TIMEOUT_MS = 3000

export type S2Deps = {
  fetch: typeof fetch
  portFree: (port: number) => Promise<boolean>
}

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const srv = createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })

// What each add-on reads at runtime (S2 8.x). World (8.3) is dropped (D-81). Add-ons run inside the agents service on 8787.
const ADDONS: Record<string, string[]> = {
  ADDON_ENS: ["ENS_SEPOLIA_RPC_URL", "ENS_PARENT_NAME", "ENS_PRIVATE_KEY"],
  ADDON_HEDERA: ["HEDERA_ACCOUNT_ID", "HEDERA_AGENT_ACCOUNT_ID", "HEDERA_AGENT_PRIVATE_KEY", "X402_FACILITATOR_URL"],
  ADDON_SWARM: ["SWARM_BEE_URL", "SWARM_BATCH_ID"],
}

async function arkiv(env: Env, deps: S2Deps): Promise<Result> {
  if (env.ARKIV_MODE !== "live") return { status: "ok", detail: "memory mode" }
  if (!env.ARKIV_ACCESS_KEY) return { status: "fail", detail: "ARKIV_MODE=live but ARKIV_ACCESS_KEY is empty" }
  try {
    const res = await deps.fetch(RABDI_PUBLIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json()) as { result?: string }
    return body.result === RABDI_CHAIN_ID_HEX
      ? { status: "ok", detail: "Rabdi chain 7794095, access key set (live counts: pnpm -F agents arkiv:stats)" }
      : { status: "fail", detail: `Rabdi RPC returned chain ${body.result ?? "nothing"}, expected ${RABDI_CHAIN_ID_HEX}` }
  } catch {
    return { status: "warn", detail: "Rabdi public RPC unreachable" }
  }
}

async function llm(env: Env, deps: S2Deps): Promise<Result> {
  if (env.MOCK_AI === "1") return { status: "ok", detail: "MOCK_AI=1" }
  const base = env.LLM_BASE_URL?.replace(/\/+$/, "")
  if (!base) return { status: "fail", detail: "LLM_BASE_URL is empty" }
  try {
    const res = await deps.fetch(`${base}/models`, {
      headers: env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { status: "fail", detail: `${base}/models returned HTTP ${res.status}` }
    const body = (await res.json()) as { data?: Array<{ id: string }> }
    const have = new Set((body.data ?? []).map((m) => m.id))
    const vision = env.VISION_BASE_URL && env.VISION_BASE_URL.replace(/\/+$/, "") !== base ? [] : [env.VISION_MODEL]
    const wanted = [env.BIDDER_MODEL, env.LISTING_MODEL, ...vision].filter((m): m is string => Boolean(m))
    if (!env.BIDDER_MODEL || !env.LISTING_MODEL || !env.VISION_MODEL) return { status: "fail", detail: "MOCK_AI=0 needs BIDDER_MODEL, LISTING_MODEL and VISION_MODEL" }
    const missing = wanted.filter((m) => !have.has(m))
    if (missing.length) return { status: "warn", detail: `Models not served by ${base}: ${missing.join(", ")}` }
    return { status: "ok", detail: `${base} serves ${have.size} models${wanted.length ? `, including ${wanted.join(", ")}` : ""}` }
  } catch {
    return { status: "fail", detail: `${base}/models unreachable` }
  }
}

// Vision on its own provider (e.g. the 0G Router): the model must be listed, and 0G grades need verify_tee for the badge.
async function vision(env: Env, deps: S2Deps): Promise<Result> {
  if (env.MOCK_AI === "1") return { status: "ok", detail: "MOCK_AI=1" }
  const base = env.VISION_BASE_URL?.replace(/\/+$/, "")
  if (!base || base === env.LLM_BASE_URL?.replace(/\/+$/, "")) return { status: "ok", detail: "vision shares LLM_BASE_URL (checked in the LLM row)" }
  const zg = /0g\.ai|integratenetwork/.test(base)
  const verify = /"verify_tee"\s*:\s*true/.test(env.VISION_EXTRA_BODY ?? "")
  try {
    const res = await deps.fetch(`${base}/models`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { status: "warn", detail: `${base}/models returned HTTP ${res.status}; grading falls back to ${env.VISION_FALLBACK === "0" ? "nothing (VISION_FALLBACK=0)" : "the LLM_* model"}` }
    const body = (await res.json()) as { data?: Array<{ id: string }> }
    if (!(body.data ?? []).some((m) => m.id === env.VISION_MODEL)) return { status: "fail", detail: `${base} does not serve VISION_MODEL ${env.VISION_MODEL ?? "(empty)"}` }
    if (zg && !verify) return { status: "warn", detail: `0G Router serves ${env.VISION_MODEL}, but VISION_EXTRA_BODY lacks "verify_tee":true, so grades are never attested` }
    return { status: "ok", detail: `${base} serves ${env.VISION_MODEL}${zg ? ", verify_tee on" : ""}` }
  } catch {
    return { status: "warn", detail: `${base}/models unreachable; grading falls back to the LLM_* model` }
  }
}

// Seller sessions (ICR-006) and the public web URL that handover links and phones use.
function humans(env: Env): Result {
  const notes: string[] = []
  let status: Result["status"] = "ok"
  if (!env.SELLER_PIN) {
    status = "warn"
    notes.push("SELLER_PIN empty: seller sessions are off, so no handover codes or no-show contests")
  } else if (env.SELLER_PIN.length < 4) return { status: "fail", detail: "SELLER_PIN must be at least 4 characters" }
  const web = env.PUBLIC_WEB_URL ?? "http://localhost:8080"
  if (!/^https?:\/\/[^\s<>]+$/.test(web)) return { status: "fail", detail: "PUBLIC_WEB_URL is not a URL (replace the <tunnel> placeholder)" }
  if (/localhost|127\.0\.0\.1/.test(web)) notes.push("PUBLIC_WEB_URL is localhost: phones need the tunnel URL")
  return { status, detail: notes.length ? notes.join("; ") : `seller PIN set, web at ${web}` }
}

async function ports(env: Env, deps: S2Deps): Promise<Result> {
  const list = [
    ["AGENTS_PORT", env.AGENTS_PORT ?? "8787"],
    ["RELAY_PORT", env.RELAY_PORT ?? "8788"],
  ] as const
  const busy: string[] = []
  for (const [, p] of list) if (!(await deps.portFree(Number(p)))) busy.push(p)
  return busy.length
    ? { status: "warn", detail: `In use: ${busy.join(", ")} (service already running?)` }
    : { status: "ok", detail: `Free: ${list.map(([, p]) => p).join(", ")}` }
}

function addons(env: Env): Result {
  const on = Object.keys(ADDONS).filter((k) => env[k] === "1")
  if (!on.length) return { status: "ok", detail: "All add-ons off" }
  const missing = on.flatMap((k) => ADDONS[k]!.filter((v) => !env[v]))
  return missing.length
    ? { status: "fail", detail: `Missing for ${on.join(", ")}: ${missing.join(", ")}` }
    : { status: "ok", detail: `On: ${on.join(", ")}` }
}

export const s2Checks = (deps: S2Deps = { fetch, portFree }): Check[] => [
  { id: "s2-arkiv", owner: "S2", title: "Arkiv Rabdi", run: ({ env }) => arkiv(env, deps) },
  { id: "s2-llm", owner: "S2", title: "LLM endpoint", run: ({ env }) => llm(env, deps) },
  { id: "s2-vision", owner: "S2", title: "Vision model", run: ({ env }) => vision(env, deps) },
  { id: "s2-humans", owner: "S2", title: "Seller sessions and web URL", run: ({ env }) => humans(env) },
  { id: "s2-ports", owner: "S2", title: "S2 ports", run: ({ env }) => ports(env, deps) },
  { id: "s2-addons", owner: "S2", title: "Add-on env", run: ({ env }) => addons(env) },
]
