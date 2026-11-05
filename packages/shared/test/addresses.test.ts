import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { loadDeployment, parseDeployment } from "../src/addresses"

const a = (n: number) => "0x" + n.toString(16).padStart(40, "0")
const sample = {
  network: "anvil",
  chainId: 84532,
  deployedAtBlock: 1,
  commit: "abc123",
  contracts: {
    TestUSD: a(1),
    TestEUR: a(2),
    AgentRegistry: a(3),
    AgentRegistryHook: a(4),
    LotFactory: a(5),
    MarketSettlement: a(6),
    ChainTrigger: a(7),
    SignalOracle: a(8),
    DisputeResolver: a(9),
    CCAFactory: a(10),
  },
  external: {
    Permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    CreForwarder: "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5",
    CircleTestUSDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    CircleTestEURC: "0x808456652fdb597867f38412077A9182bf77359F",
  },
  params: {
    feeBps: 100,
    advanceNewBps: 5000,
    advanceProvenBps: 9000,
    advanceTruckBps: 1000,
    provenAfter: 3,
    contestWindowBlocks: 60,
    reportWindowBlocks: 300,
  },
}

function dirWith(file?: string, body?: unknown) {
  const d = mkdtempSync(join(tmpdir(), "ft-dep-"))
  if (file) writeFileSync(join(d, file), JSON.stringify(body))
  return pathToFileURL(d + "/")
}

describe("deployments", () => {
  it("parses the contract section 8 shape", () => {
    expect(parseDeployment(sample).contracts.LotFactory).toBe(a(5))
  })
  it("loads deployments/<network>.json", async () => {
    expect((await loadDeployment("anvil", dirWith("anvil.json", sample))).chainId).toBe(84532)
  })
  it("names the step that creates a missing file", async () => {
    await expect(loadDeployment("base-sepolia", dirWith())).rejects.toThrow(/S1 1\.4/)
  })
  it("rejects a malformed address", () => {
    expect(() => parseDeployment({ ...sample, contracts: { ...sample.contracts, LotFactory: "0x123" } })).toThrow()
  })
  it("rejects a file whose network doesn't match the one asked for", async () => {
    await expect(loadDeployment("base-sepolia", dirWith("base-sepolia.json", sample))).rejects.toThrow(/anvil/)
  })
})
