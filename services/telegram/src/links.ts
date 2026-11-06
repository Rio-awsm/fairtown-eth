// Who each Telegram user is in Fairtown, held in memory only. Session tokens never touch disk, so a restart means
// signing in again: the agents service's own sessions are in memory too (2 h).
export type Session = { token: string; expiresAt: number }
export type SellerRole = "SELLER" | "TRUCK" | "STORAGE"
export type Link =
  | { role: SellerRole; sellerId: string; name: string; address: string; session?: Session }
  | { role: "HUMAN"; agentId: string; name: string; currency: "USD" | "EUR"; session?: Session }

// Waiting for the user's next message. Every wait has a deadline (golden rule 5 applied to chat states).
export type Pending = { kind: "pin"; sellerId: string; expiresAt: number }
export const PIN_WAIT_MS = 2 * 60_000

export class Links {
  private readonly links = new Map<number, Link>()
  private readonly pending = new Map<number, Pending>()
  private readonly busy = new Set<number>()
  constructor(private readonly now: () => number = Date.now) {}

  get(user: number) {
    return this.links.get(user)
  }
  set(user: number, link: Link) {
    this.links.set(user, link)
  }
  // Everyone linked to an address (a seller's wallet or a walk-in's agent), for notifications.
  usersFor(address: string): number[] {
    const a = address.toLowerCase()
    return [...this.links].filter(([, l]) => (l.role === "HUMAN" ? l.agentId : l.address).toLowerCase() === a).map(([u]) => u)
  }
  all(): Array<[number, Link]> {
    return [...this.links]
  }
  forget(user: number) {
    this.links.delete(user)
    this.pending.delete(user)
  }

  // The live session token, or undefined once it has expired (the link itself stays, so sign-in can be offered again).
  session(user: number): string | undefined {
    const l = this.links.get(user)
    if (!l?.session) return undefined
    if (l.session.expiresAt <= this.now()) {
      delete l.session
      return undefined
    }
    return l.session.token
  }
  // The agents service said the session is gone (e.g. it restarted): drop ours, keep the link for a quick re-sign-in.
  endSession(user: number) {
    const l = this.links.get(user)
    if (l) delete l.session
  }
  minutesLeft(user: number): number | undefined {
    const l = this.links.get(user)
    if (!this.session(user) || !l?.session) return undefined
    return Math.max(0, Math.round((l.session.expiresAt - this.now()) / 60_000))
  }

  wait(user: number, p: Omit<Pending, "expiresAt">, ms = PIN_WAIT_MS) {
    this.pending.set(user, { ...p, expiresAt: this.now() + ms })
  }
  // Returns and clears the wait in one step, so a PIN is used at most once; an expired wait counts as none.
  takePending(user: number): Pending | undefined {
    const p = this.pending.get(user)
    this.pending.delete(user)
    return p && p.expiresAt > this.now() ? p : undefined
  }
  isWaiting(user: number) {
    const p = this.pending.get(user)
    return p !== undefined && p.expiresAt > this.now()
  }
  cancel(user: number) {
    const had = this.isWaiting(user)
    this.pending.delete(user)
    return had
  }

  // One sign-in or join at a time per user: a double tap must not create two walk-in wallets.
  async exclusive<T>(user: number, f: () => Promise<T>): Promise<T | "busy"> {
    if (this.busy.has(user)) return "busy"
    this.busy.add(user)
    try {
      return await f()
    } finally {
      this.busy.delete(user)
    }
  }
}
