import { randomBytes, timingSafeEqual } from "node:crypto"

export type SessionKind = "seller" | "walkin"
export type Session = { token: string; kind: SessionKind; subject: string; expiresAt: number }

export const SESSION_MS = 2 * 60 * 60 * 1000

// In-memory bearer sessions (never on Arkiv, never logged). Expired tokens are rejected and pruned.
export class SessionStore {
  private readonly byToken = new Map<string, Session>()
  constructor(private readonly now: () => number = Date.now) {}

  create(kind: SessionKind, subject: string, ttlMs = SESSION_MS): Session {
    const s = { token: randomBytes(24).toString("base64url"), kind, subject, expiresAt: this.now() + ttlMs }
    this.byToken.set(s.token, s)
    return s
  }
  get(token: string | undefined, kind: SessionKind): Session | undefined {
    if (!token) return undefined
    const s = this.byToken.get(token)
    if (!s || s.kind !== kind) return undefined
    if (s.expiresAt <= this.now()) {
      this.byToken.delete(token)
      return undefined
    }
    return s
  }
}

export const bearer = (h: string | undefined) => (h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined)

export function samePin(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// Sliding window per key (IP) plus a cap on the total over the whole run.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private total = 0
  constructor(
    private readonly perKey: number,
    private readonly windowMs: number,
    private readonly cap: number,
    private readonly now: () => number = Date.now,
  ) {}
  take(key: string): { ok: true } | { ok: false; reason: "rate_limited" | "cap_reached" } {
    if (this.total >= this.cap) return { ok: false, reason: "cap_reached" }
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs)
    if (recent.length >= this.perKey) return { ok: false, reason: "rate_limited" }
    recent.push(t)
    this.hits.set(key, recent)
    this.total++
    return { ok: true }
  }
}
