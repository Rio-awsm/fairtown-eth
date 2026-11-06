import { z } from "zod"

/** The walk-in's session: kept in memory and in sessionStorage, so a reload keeps you in (S3 3.2). */
export const WalkinSession = z.object({
  agentId: z.string(),
  address: z.string(),
  token: z.string(),
  name: z.string(),
  avatar: z.string(),
  budget: z.string().regex(/^\d+$/).optional(),
})
export type WalkinSession = z.infer<typeof WalkinSession>
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

const KEY = "fairtown.walkin"
let memory: WalkinSession | null = null

/** sessionStorage, or null where touching it throws (Safari private mode, blocked storage). */
function browserStorage(): StorageLike | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function saveSession(session: WalkinSession, storage: StorageLike | null = browserStorage()): void {
  memory = session
  try {
    storage?.setItem(KEY, JSON.stringify(session))
  } catch (error: unknown) {
    console.warn("walk-in session kept in memory only", error)
  }
}

export function loadSession(storage: StorageLike | null = browserStorage()): WalkinSession | null {
  if (memory) return memory
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return null
    const parsed = WalkinSession.safeParse(JSON.parse(raw))
    memory = parsed.success ? parsed.data : null
    return memory
  } catch (error: unknown) {
    console.warn("could not read the walk-in session", error)
    return null
  }
}

export function clearSession(
  storage: StorageLike | null = browserStorage(),
  opts: { memoryOnly?: boolean } = {},
): void {
  memory = null
  if (opts.memoryOnly) return
  try {
    storage?.removeItem(KEY)
  } catch (error: unknown) {
    console.warn("could not clear the walk-in session", error)
  }
}
