export const DEFAULT_EXPLORER = "https://sepolia.basescan.org"

export class EnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnvError"
  }
}

export type RelayEnv = { mode: "mock" } | { mode: "live"; wsUrl: string; snapshotUrl: string }
export type ArkivEnv = { mode: "mock" } | { mode: "live"; accessKey: string }
export type ApiEnv = { mode: "mock"; baseUrl: "" } | { mode: "live"; baseUrl: string }

export type WebEnv = {
  relay: RelayEnv
  api: ApiEnv
  /** Arkiv ledger reads: live Rabdi, or the mock ledger built from the replay. */
  arkiv: ArkivEnv
  /** Block explorer for tx and address links. Defaults to Base Sepolia, the demo chain (D-02). */
  explorerUrl: string
  /** HTTPS address phones use (PUBLIC_WEB_URL), for the walk-in QR. Undefined when unset or a placeholder. */
  publicWebUrl?: string
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

function readArkiv(mode: string | undefined, accessKey: string | undefined): ArkivEnv {
  if (mode === undefined || mode === "mock") return { mode: "mock" }
  if (mode !== "live") throw new EnvError(`VITE_ARKIV must be "live" or "mock", got "${mode}"`)
  return { mode: "live", accessKey: accessKey ?? "" }
}

function readPublicUrl(raw: string | undefined): string | undefined {
  if (!raw || !/^https?:\/\/[^<>\s]+$/.test(raw)) return undefined
  try {
    return new URL(raw).toString().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

/** Reads `import.meta.env`. Unset relay or API means mock, so the stream runs alone (contract 13). */
export function readEnv(raw: Record<string, unknown>): WebEnv {
  const explorerUrl = (str(raw.VITE_EXPLORER_URL) ?? DEFAULT_EXPLORER).replace(/\/$/, "")
  const publicWebUrl = readPublicUrl(str(raw.PUBLIC_WEB_URL))
  return {
    ...(publicWebUrl ? { publicWebUrl } : {}),
    relay: readRelay(str(raw.VITE_RELAY_URL)),
    arkiv: readArkiv(str(raw.VITE_ARKIV), str(raw.VITE_ARKIV_ACCESS_KEY)),
    api: readApi(str(raw.VITE_API_URL)),
    explorerUrl,
    exposeTown: raw.PROD !== true,
  }
}
