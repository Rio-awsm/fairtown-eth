import { BaseError, encodeAbiParameters, encodeEventTopics, type Hex, type Log } from "viem"
import { generatePrivateKey } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { continuousClearingAuctionAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { toKey } from "@fairtown/shared/keys"
import { DEFAULT_CHECKPOINT_BLOCKS, keeperConfig } from "../src/config"
import { errText } from "../src/log"
import { KeeperState, reportKey } from "../src/state"
import { addr, captureLogger } from "./fakes"

const SECRET_URL = "https://base-sepolia.example/v2/SECRET_RPC_KEY_456"

describe("keeperConfig", () => {
  const key = generatePrivateKey()
  it("reads network from the argument or CHAIN_MODE, and the D-54 default cadence", () => {
    const c = keeperConfig({ RPC_URL: SECRET_URL, KEEPER_PRIVATE_KEY: key, CHAIN_MODE: "base-sepolia" })
    expect(c.network).toBe("base-sepolia")
    expect(c.checkpointEvery).toBe(DEFAULT_CHECKPOINT_BLOCKS)
    expect(keeperConfig({ KEEPER_PRIVATE_KEY: key }, "anvil").network).toBe("anvil")
    expect(keeperConfig({ KEEPER_PRIVATE_KEY: key, KEEPER_CHECKPOINT_BLOCKS: "10" }, "anvil").checkpointEvery).toBe(10n)
  })
  it("rejects fake mode, a missing key, a bad cadence", () => {
    expect(() => keeperConfig({ CHAIN_MODE: "fake", KEEPER_PRIVATE_KEY: key })).toThrow(/fake/)
    expect(() => keeperConfig({}, "anvil")).toThrow(/KEEPER_PRIVATE_KEY is unset/)
    for (const bad of ["0", "-1", "2.5", "abc", "100001"]) {
      expect(() => keeperConfig({ KEEPER_PRIVATE_KEY: key, KEEPER_CHECKPOINT_BLOCKS: bad }, "anvil")).toThrow(
        /KEEPER_CHECKPOINT_BLOCKS/,
      )
    }
  })
  it("never echoes a bad key value", () => {
    const bad = "0xdeadbeefSECRET"
    try {
      keeperConfig({ KEEPER_PRIVATE_KEY: bad }, "anvil")
      expect.unreachable()
    } catch (e) {
      expect(String(e)).not.toContain("SECRET")
    }
  })
})

describe("logger", () => {
  it("censors secret fields and scrubs secret values from messages and string fields", () => {
    const key = generatePrivateKey()
    const { log, text } = createCapture([SECRET_URL, key])
    log.info({ rpcUrl: SECRET_URL, keeperKey: key, note: `calling ${SECRET_URL}` }, `start ${SECRET_URL} ${key}`)
    log.warn({ nested: { privateKey: key } }, "x")
    const out = text()
    expect(out).not.toContain("SECRET_RPC_KEY_456")
    expect(out).not.toContain(key.slice(2))
    expect(out).toContain("[redacted]")
  })
  it("errText drops viem's URL line", () => {
    const e = new BaseError("HTTP request failed.", { details: "fetch failed", metaMessages: [`URL: ${SECRET_URL}`] })
    expect(errText(e, [SECRET_URL])).not.toContain("SECRET_RPC_KEY_456")
  })
})

function createCapture(secrets: string[]) {
  return captureLogger(secrets)
}

describe("KeeperState intake", () => {
  const log = (
    abi: readonly unknown[],
    eventName: string,
    args: Record<string, unknown>,
    address: Hex,
    block = 10n,
  ) => {
    const item = (
      abi as { type: string; name: string; inputs: { name: string; type: string; indexed?: boolean }[] }[]
    ).find((x) => x.type === "event" && x.name === eventName)!
    const topics = encodeEventTopics({ abi: [item], eventName, args } as never) as [Hex, ...Hex[]]
    const data = item.inputs.filter((i) => !i.indexed)
    return {
      address,
      topics,
      data: encodeAbiParameters(data, data.map((i) => args[i.name]) as never),
      blockNumber: block,
      logIndex: 0,
      transactionIndex: 0,
      transactionHash: `0x${"1".padStart(64, "0")}`,
      blockHash: `0x${"2".padStart(64, "0")}`,
      removed: false,
    } as unknown as Log
  }
  const auction = addr(0xa1)

  it("tracks lots, bids on our auctions only, settles, carriers and no-show lifecycle", () => {
    const s = new KeeperState()
    s.ingestCore([
      log(
        lotFactoryAbi,
        "LotListed",
        {
          lotId: 1n,
          seller: addr(5),
          market: toKey("fish_dock"),
          auction,
          token: addr(0xb1),
          currency: addr(0xe),
          sector: toKey("fish"),
          commodity: toKey("cod"),
          place: toKey("bergen"),
          qty: 600n,
          floorPerUnit: 7_500_000n,
          startBlock: 11n,
          endBlock: 461n,
          parentLotId: 0n,
          metadataURI: "x",
        },
        addr(0xf),
      ),
    ])
    expect(s.lots.get(1n)).toMatchObject({ sector: "fish", auction, endBlock: 461n })
    expect(s.auctionsLiveIn(0n, 10n)).toEqual([])
    expect(s.auctionsLiveIn(400n, 500n)).toEqual([auction])

    s.ingestBids([
      log(continuousClearingAuctionAbi, "BidSubmitted", { id: 0n, owner: addr(9), priceQ96: 1n, amount: 1n }, auction),
      log(
        continuousClearingAuctionAbi,
        "BidSubmitted",
        { id: 0n, owner: addr(9), priceQ96: 1n, amount: 1n },
        addr(0xbad),
      ),
    ])
    expect([...s.bids.get(1n)!.entries()]).toEqual([[0n, addr(9)]])

    const ms = addr(0x5e)
    s.ingestCore([
      log(
        marketSettlementAbi,
        "LotSettled",
        {
          lotId: 1n,
          finalClearingPerUnit: 1n,
          avgPerUnit: 1n,
          soldUnits: 600n,
          raised: 1n,
          sellerPaid: 1n,
          held: 1n,
          fee: 0n,
          advanceBps: 5000,
          pickupDeadline: 3_500n,
        },
        ms,
      ),
      log(marketSettlementAbi, "CarrierAssigned", { lotId: 1n, truckLotId: 2n, carrier: addr(7) }, ms),
      log(
        marketSettlementAbi,
        "NoShowReported",
        { lotId: 1n, buyer: addr(9), tokenAmount: 1n, contestEnds: 4_000n },
        ms,
      ),
    ])
    expect(s.settled.get(1n)).toEqual({ soldUnits: 600n, held: 1n, pickupDeadline: 3_500n })
    expect(s.carriers.has(1n)).toBe(true)
    expect(s.reports.get(reportKey(1n, addr(9)))).toMatchObject({ contestEnds: 4_000n, contested: false })
    s.ingestCore([log(marketSettlementAbi, "NoShowContested", { lotId: 1n, buyer: addr(9), disputeId: 1n }, ms)])
    expect(s.reports.get(reportKey(1n, addr(9)))!.contested).toBe(true)
    s.ingestCore([
      log(marketSettlementAbi, "NoShowRefunded", { lotId: 1n, seller: addr(5), buyer: addr(9), refund: 1n }, ms),
    ])
    expect(s.reports.size).toBe(0)
  })
})
