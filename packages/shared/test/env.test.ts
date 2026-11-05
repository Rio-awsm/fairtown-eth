import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { expandEnv, loadEnv } from "../src/env"

describe("expandEnv", () => {
  it("expands ${VAR} references, including chains", () => {
    const env = expandEnv({
      RPC_URL: "https://sepolia.base.org",
      FORK_RPC_URL: "${RPC_URL}",
      LLM_BASE_URL: "http://localhost:11434/v1",
      VISION_BASE_URL: "${LLM_BASE_URL}",
      STT_BASE_URL: "${VISION_BASE_URL}",
    })
    expect(env.FORK_RPC_URL).toBe("https://sepolia.base.org")
    expect(env.STT_BASE_URL).toBe("http://localhost:11434/v1")
  })
  it("turns unknown references into empty strings", () => {
    expect(expandEnv({ A: "x${NOPE}y" }).A).toBe("xy")
  })
  it("stops on a reference cycle instead of hanging", () => {
    const env = expandEnv({ A: "${B}", B: "${A}" })
    expect(env.A).not.toContain("${")
  })
  it("leaves undefined values alone", () => {
    expect(expandEnv({ A: undefined }).A).toBeUndefined()
  })
})

describe("loadEnv", () => {
  const file = (body: string) => {
    const d = mkdtempSync(join(tmpdir(), "ft-env-"))
    writeFileSync(join(d, ".env"), body)
    return join(d, ".env")
  }
  it("reports a missing file and still returns the shell env", () => {
    const { env, found } = loadEnv("/nonexistent/.env", { CHAIN_MODE: "fake" })
    expect(found).toBe(false)
    expect(env.CHAIN_MODE).toBe("fake")
  })
  it("reads the file, lets the shell override it, and expands", () => {
    const { env, found } = loadEnv(
      file("CHAIN_MODE=base-sepolia # comment\nLLM_BASE_URL=http://a/v1\nVISION_BASE_URL=${LLM_BASE_URL}\n"),
      { CHAIN_MODE: "fake" },
    )
    expect(found).toBe(true)
    expect(env.CHAIN_MODE).toBe("fake")
    expect(env.VISION_BASE_URL).toBe("http://a/v1")
  })
})
