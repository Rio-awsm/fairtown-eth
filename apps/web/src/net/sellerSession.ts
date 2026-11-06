// The seller's session (ICR-009): the seller key signs handover tickets and no-show contests only inside it.
// Kept in memory and sessionStorage (this tab only), never in localStorage; it expires after 2 h on the server.

export type SellerSession = { sellerId: string; token: string; expiresAt: string }

const KEY = "fairtown.sellerSession"
let current: SellerSession | undefined = load()

function live(s: SellerSession | undefined): s is SellerSession {
  return s !== undefined && Date.parse(s.expiresAt) > Date.now()
}

function load(): SellerSession | undefined {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY)
    const s = raw ? (JSON.parse(raw) as SellerSession) : undefined
    return live(s) ? s : undefined
  } catch {
    return undefined
  }
}

export function setSellerSession(s: SellerSession) {
  current = s
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private mode or blocked storage: the session still works in memory for this page.
  }
}

export function clearSellerSession() {
  current = undefined
  try {
    globalThis.sessionStorage?.removeItem(KEY)
  } catch {
    // Nothing stored.
  }
}

export function hasSellerSession(sellerId: string): boolean {
  return live(current) && current.sellerId === sellerId
}

/** Bearer token for seller-only routes, or undefined when there is no live session. */
export function sellerToken(): string | undefined {
  return live(current) ? current.token : undefined
}
