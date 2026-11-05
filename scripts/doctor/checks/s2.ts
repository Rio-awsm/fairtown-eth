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

const ADDONS: Record<string, string[]> = {
  ADDON_ENS: ["ENS_SEPOLIA_RPC_URL", "ENS_PARENT_NAME"],
  ADDON_WORLD: ["WORLD_CLIENT_ID", "WORLD_CLIENT_SECRET"],
  ADDON_HEDERA: ["HEDERA_ACCOUNT_ID", "HEDERA_PRIVATE_KEY", "X402_FACILITATOR_URL"],
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
      ? { status: "ok", detail: "Rabdi chain 7794095, access key set (keyed write check lands in S2 2.1)" }
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
    const wanted = [env.BIDDER_MODEL, env.LISTING_MODEL].filter((m): m is string => Boolean(m))
    const missing = wanted.filter((m) => !have.has(m))
    if (missing.length) return { status: "warn", detail: `Models not served by ${base}: ${missing.join(", ")}` }
    return { status: "ok", detail: `${base} serves ${have.size} models${wanted.length ? `, including ${wanted.join(", ")}` : ""}` }
  } catch {
    return { status: "fail", detail: `${base}/models unreachable` }
  }
}

async function ports(env: Env, deps: S2Deps): Promise<Result> {
  const list = [
    ["AGENTS_PORT", env.AGENTS_PORT ?? "8787"],
    ["RELAY_PORT", env.RELAY_PORT ?? "8788"],
    ["ADDONS_PORT", env.ADDONS_PORT ?? "8790"],
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
  { id: "s2-ports", owner: "S2", title: "S2 ports", run: ({ env }) => ports(env, deps) },
  { id: "s2-addons", owner: "S2", title: "Add-on env", run: ({ env }) => addons(env) },
]
