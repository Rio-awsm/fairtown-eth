import { describe, expect, it } from "vitest"
import { parseArgs, redactAll, secretsOf } from "./with-env"

const URL_WITH_KEY = "https://base-sepolia.example/v2/SECRET_RPC_KEY"
const KEY = `0x${"ab".repeat(32)}`

describe("with-env", () => {
  it("parses --cwd and the command", () => {
    expect(parseArgs(["--cwd", "contracts", "--", "forge", "script", "x"])).toEqual({
      cwd: "contracts",
      cmd: "forge",
      args: ["script", "x"],
    })
    expect(parseArgs(["forge", "build"])).toEqual({ cwd: null, cmd: "forge", args: ["build"] })
  })
  it("fails without a command or a --cwd value", () => {
    expect(() => parseArgs([])).toThrow(/Usage/)
    expect(() => parseArgs(["--cwd"])).toThrow(/--cwd needs/)
  })
  it("redacts every secret from output, URL before the key it contains", () => {
    const env = {
      RPC_URL: URL_WITH_KEY,
      ETHERSCAN_API_KEY: "SECRET_RPC_KEY",
      DEPLOYER_PRIVATE_KEY: KEY,
      CHAIN_ID: "84532",
    }
    const s = secretsOf(env)
    expect(s.indexOf(URL_WITH_KEY)).toBeLessThan(s.indexOf("SECRET_RPC_KEY")) // container before contained
    const out = redactAll(`rpc ${URL_WITH_KEY} key ${KEY} api SECRET_RPC_KEY chain 84532`, s)
    expect(out).not.toContain("SECRET_RPC_KEY")
    expect(out).not.toContain("abab")
    expect(out).toContain("chain 84532")
  })
  it("ignores unset or very short values", () => {
    expect(secretsOf({ RPC_URL: "", ETHERSCAN_API_KEY: "x" })).toEqual([])
  })
})
