import { encodeAbiParameters, encodeEventTopics, type Hex, type Log } from "viem"
import { describe, expect, it } from "vitest"
import { disputeResolverAbi } from "@fairtown/shared/abi"
import { DONE_ERRORS, NEVER_ERRORS } from "../src/txQueue"
import { KeeperState, addr } from "./fakes"

const RESOLVER = addr(0xd15)

function log(topics: Hex[], data: Hex, blockNumber: bigint | null): Log {
  return {
    address: RESOLVER,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber,
    blockHash: blockNumber === null ? null : `0x${"11".repeat(32)}`,
    logIndex: 0,
    transactionHash: `0x${"22".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  } as Log
}

const opened = (id: bigint, lotId: bigint, block: bigint | null) =>
  log(
    encodeEventTopics({
      abi: disputeResolverAbi,
      eventName: "DisputeOpened",
      args: { disputeId: id, lotId, buyer: addr(0xb1) },
    }) as Hex[],
    encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint256" }, { type: "bytes32" }, { type: "string" }],
      [0, 10n ** 18n, `0x${"ab".repeat(32)}`, "ipfs://photos"],
    ),
    block,
  )
const resolved = (id: bigint, lotId: bigint) =>
  log(
    encodeEventTopics({
      abi: disputeResolverAbi,
      eventName: "DisputeResolved",
      args: { disputeId: id, lotId },
    }) as Hex[],
    encodeAbiParameters([{ type: "uint16" }, { type: "bytes32" }], [4000, `0x${"cd".repeat(32)}`]),
    900n,
  )
const expired = (id: bigint, lotId: bigint) =>
  log(
    encodeEventTopics({
      abi: disputeResolverAbi,
      eventName: "DisputeExpired",
      args: { disputeId: id, lotId },
    }) as Hex[],
    "0x",
    950n,
  )

describe("KeeperState.ingestDisputes (S1 4.1)", () => {
  it("tracks opened disputes with their block, drops resolved and expired ones, idempotently", () => {
    const s = new KeeperState()
    s.ingestDisputes([opened(1n, 5n, 800n), opened(2n, 6n, 810n), opened(3n, 6n, 820n)])
    s.ingestDisputes([opened(1n, 5n, 800n)]) // overlap from a re-read range
    expect([...s.disputes.keys()]).toEqual([1n, 2n, 3n])
    expect(s.disputes.get(2n)).toEqual({ disputeId: 2n, lotId: 6n, openedBlock: 810n })
    s.ingestDisputes([resolved(1n, 5n), expired(3n, 6n)])
    expect([...s.disputes.keys()]).toEqual([2n])
  })
  it("ignores pending logs (no block number) and unrelated logs", () => {
    const s = new KeeperState()
    s.ingestDisputes([opened(9n, 1n, null), log([`0x${"00".repeat(32)}`], "0x", 1n)])
    expect(s.disputes.size).toBe(0)
  })
  it("treats DisputeNotOpen as done and NoTransport as never (D-58)", () => {
    expect(DONE_ERRORS.has("DisputeNotOpen")).toBe(true)
    expect(NEVER_ERRORS.has("NoTransport")).toBe(true)
  })
})
