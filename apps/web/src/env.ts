export class EnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnvError"
  }
}

export type RelayEnv = { mode: "mock" } | { mode: "live"; wsUrl: string; snapshotUrl: string }
export type ApiEnv = { mode: "mock"; baseUrl: "" } | { mode: "live"; baseUrl: string }

export type WebEnv = {
  relay: RelayEnv
  api: ApiEnv
  explorerUrl?: string
  /** window.__TOWN__ is a test hook and must never ship to production. */
  exposeTown: boolean
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

/** `ws://h:8788/ws` → `http://h:8788/snapshot` (contract 12.3). */
export function snapshotUrlFor(wsUrl: string): string {
  const url = new URL(wsUrl)
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  url.pathname = url.pathname.replace(/\/ws\/?$/, "") + "/snapshot"
  return url.toString()
}

function readRelay(raw: string | undefined): RelayEnv {
  if (raw === undefined || raw === "mock") return { mode: "mock" }
  if (!/^wss?:\/\//.test(raw))
    throw new EnvError(`VITE_RELAY_URL must be "mock" or a ws:// or wss:// URL, got "${raw}"`)
  return { mode: "live", wsUrl: raw, snapshotUrl: snapshotUrlFor(raw) }
}

function readApi(raw: string | undefined): ApiEnv {
  if (raw === undefined || raw === "mock") return { mode: "mock", baseUrl: "" }
  if (!/^https?:\/\//.test(raw)) throw new EnvError(`VITE_API_URL must be "mock" or an http(s) URL, got "${raw}"`)
  return { mode: "live", baseUrl: raw.replace(/\/$/, "") }
}

/** Reads `import.meta.env`. Unset relay or API means mock, so the stream runs alone (contract 13). */
export function readEnv(raw: Record<string, unknown>): WebEnv {
  const explorerUrl = str(raw.VITE_EXPLORER_URL)
  return {
    relay: readRelay(str(raw.VITE_RELAY_URL)),
    api: readApi(str(raw.VITE_API_URL)),
    ...(explorerUrl ? { explorerUrl } : {}),
    exposeTown: raw.PROD !== true,
  }
}
