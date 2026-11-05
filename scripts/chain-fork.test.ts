import { describe, expect, it } from "vitest"
import { anvilArgs, REDACTED, redact } from "./chain-fork"

const URL_WITH_KEY = "https://base-sepolia.example/v2/SECRET_RPC_KEY"

describe("chain:fork", () => {
  it("forks FORK_RPC_URL as chain 84532 on 8545", () => {
    const { args } = anvilArgs({ FORK_RPC_URL: URL_WITH_KEY, RPC_URL: "https://other" })
    expect(args).toEqual(["--fork-url", URL_WITH_KEY, "--chain-id", "84532", "--port", "8545"])
  })
  it("falls back to RPC_URL", () => {
    expect(anvilArgs({ RPC_URL: "https://sepolia.base.org" }).url).toBe("https://sepolia.base.org")
  })
  it("fails when no URL is set, or it is empty", () => {
    expect(() => anvilArgs({})).toThrow(/unset/)
    expect(() => anvilArgs({ FORK_RPC_URL: "", RPC_URL: "" })).toThrow(/unset/)
  })
  it("rejects a non-http URL without echoing it", () => {
    let msg = ""
    try {
      anvilArgs({ FORK_RPC_URL: "wss://x/SECRET_RPC_KEY" })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/http/)
    expect(msg).not.toContain("SECRET_RPC_KEY")
  })
  it("redacts the URL from anvil's banner", () => {
    const banner = `Fork\n==================\nEndpoint:       ${URL_WITH_KEY}\nBlock number:   1\n`
    const out = redact(banner, URL_WITH_KEY)
    expect(out).not.toContain("SECRET_RPC_KEY")
    expect(out).toContain(`Endpoint:       ${REDACTED}`)
  })
})
