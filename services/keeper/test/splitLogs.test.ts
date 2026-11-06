import { createPublicClient, custom } from "viem"
import { describe, expect, it } from "vitest"
import { splitLogsTransport } from "../src/lib"

const recorder = (name: string, calls: string[]) =>
  custom({
    request: async ({ method }) => {
      calls.push(`${name}:${method}`)
      return method === "eth_getLogs" ? [] : method === "eth_chainId" ? "0x14a34" : "0x10"
    },
  })

describe("splitLogsTransport", () => {
  it("sends eth_getLogs to the logs RPC and every other call to the main RPC", async () => {
    const calls: string[] = []
    const pub = createPublicClient({ transport: splitLogsTransport(recorder("main", calls), recorder("logs", calls)) })
    await pub.getBlockNumber()
    await pub.getLogs({ fromBlock: 1n, toBlock: 2n })
    expect(calls).toContain("main:eth_blockNumber")
    expect(calls).toContain("logs:eth_getLogs")
    expect(calls).not.toContain("main:eth_getLogs")
    expect(calls).not.toContain("logs:eth_blockNumber")
  })

  it("uses the main RPC for everything when no logs RPC is set", async () => {
    const calls: string[] = []
    const pub = createPublicClient({ transport: splitLogsTransport(recorder("main", calls), undefined) })
    await pub.getLogs({ fromBlock: 1n, toBlock: 2n })
    expect(calls).toEqual(["main:eth_getLogs"])
  })
})
