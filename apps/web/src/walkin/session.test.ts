import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearSession, loadSession, saveSession, type WalkinSession } from "./session"

const s: WalkinSession = { agentId: "0x01", address: "0x01", token: "abc", name: "Priya", avatar: "trader" }

class MemoryStorage {
  map = new Map<string, string>()
  getItem = (k: string) => this.map.get(k) ?? null
  setItem = (k: string, v: string) => void this.map.set(k, v)
  removeItem = (k: string) => void this.map.delete(k)
}
const throwing = {
  getItem: () => {
    throw new Error("SecurityError")
  },
  setItem: () => {
    throw new Error("QuotaExceededError")
  },
  removeItem: () => {
    throw new Error("SecurityError")
  },
}

beforeEach(() => {
  clearSession(new MemoryStorage())
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("walk-in session", () => {
  it("survives a reload through sessionStorage", () => {
    const storage = new MemoryStorage()
    saveSession(s, storage)
    clearSession(new MemoryStorage(), { memoryOnly: true })
    expect(loadSession(storage)).toEqual(s)
  })

  it("keeps working in memory when storage throws (Safari private mode)", () => {
    saveSession(s, throwing)
    expect(loadSession(throwing)).toEqual(s)
    expect(console.warn).toHaveBeenCalled()
  })

  it("ignores a stored value that is not a session", () => {
    const storage = new MemoryStorage()
    storage.setItem("fairtown.walkin", JSON.stringify({ hello: "world" }))
    expect(loadSession(storage)).toBeNull()
    storage.setItem("fairtown.walkin", "not json")
    expect(loadSession(storage)).toBeNull()
  })

  it("forgets the session on leave", () => {
    const storage = new MemoryStorage()
    saveSession(s, storage)
    clearSession(storage)
    expect(loadSession(storage)).toBeNull()
  })
})
