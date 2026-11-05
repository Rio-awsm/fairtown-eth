import { describe, expect, it } from "vitest"
import { EnvError, readEnv, snapshotUrlFor } from "./env"

describe("readEnv", () => {
  it("defaults to mock relay and mock API when nothing is set", () => {
    const env = readEnv({ DEV: true, PROD: false })
    expect(env.relay).toEqual({ mode: "mock" })
    expect(env.api).toEqual({ mode: "mock", baseUrl: "" })
    expect(env.exposeTown).toBe(true)
  })

  it("treats the literal value mock as mock", () => {
    const env = readEnv({ VITE_RELAY_URL: "mock", VITE_API_URL: "mock" })
    expect(env.relay.mode).toBe("mock")
    expect(env.api.mode).toBe("mock")
  })

  it("parses live relay and API URLs and derives the snapshot URL", () => {
    const env = readEnv({ VITE_RELAY_URL: "ws://localhost:8788/ws", VITE_API_URL: "http://localhost:8787" })
    expect(env.relay).toEqual({
      mode: "live",
      wsUrl: "ws://localhost:8788/ws",
      snapshotUrl: "http://localhost:8788/snapshot",
    })
    expect(env.api).toEqual({ mode: "live", baseUrl: "http://localhost:8787" })
  })

  it("keeps the explorer URL when set", () => {
    expect(readEnv({ VITE_EXPLORER_URL: "https://sepolia.basescan.org" }).explorerUrl).toBe(
      "https://sepolia.basescan.org",
    )
  })

  it("defaults the explorer to Base Sepolia (D-02) so every tx gets a link", () => {
    expect(readEnv({}).explorerUrl).toBe("https://sepolia.basescan.org")
  })

  it("drops a trailing slash from the explorer URL", () => {
    expect(readEnv({ VITE_EXPLORER_URL: "https://example.org/" }).explorerUrl).toBe("https://example.org")
  })

  it("reads the public web URL phones use for the walk-in QR", () => {
    expect(readEnv({ PUBLIC_WEB_URL: "https://abc.trycloudflare.com/" }).publicWebUrl).toBe(
      "https://abc.trycloudflare.com",
    )
  })

  it("treats the .env.example placeholder or a bad value as unset", () => {
    expect(readEnv({ PUBLIC_WEB_URL: "https://<tunnel>.trycloudflare.com" }).publicWebUrl).toBeUndefined()
    expect(readEnv({ PUBLIC_WEB_URL: "ftp://x" }).publicWebUrl).toBeUndefined()
    expect(readEnv({}).publicWebUrl).toBeUndefined()
  })

  it("reads the Arkiv ledger mode and read key", () => {
    expect(readEnv({}).arkiv).toEqual({ mode: "mock" })
    expect(readEnv({ VITE_ARKIV: "live", VITE_ARKIV_ACCESS_KEY: "k1" }).arkiv).toEqual({
      mode: "live",
      accessKey: "k1",
    })
    expect(readEnv({ VITE_ARKIV: "live" }).arkiv).toEqual({ mode: "live", accessKey: "" })
  })

  it("rejects an unknown Arkiv mode", () => {
    expect(() => readEnv({ VITE_ARKIV: "memory" })).toThrow(EnvError)
  })

  it("rejects a relay URL that is not ws, wss or mock", () => {
    expect(() => readEnv({ VITE_RELAY_URL: "http://nope" })).toThrow(EnvError)
  })

  it("rejects an API URL that is not http, https or mock", () => {
    expect(() => readEnv({ VITE_API_URL: "ftp://x" })).toThrow(EnvError)
  })

  it("never exposes __TOWN__ in production", () => {
    expect(readEnv({ PROD: true, DEV: false }).exposeTown).toBe(false)
  })
})

describe("snapshotUrlFor", () => {
  it("maps wss to https and strips /ws", () => {
    expect(snapshotUrlFor("wss://x.trycloudflare.com/ws")).toBe("https://x.trycloudflare.com/snapshot")
  })

  it("keeps a path prefix in front of /ws", () => {
    expect(snapshotUrlFor("ws://h:8788/relay/ws")).toBe("http://h:8788/relay/snapshot")
  })
})
