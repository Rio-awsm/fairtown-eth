/**
 * S1 2.1 integration: the keeper on a fresh local anvil (D-56). Hermetic: no RPC, no .env keys, no network.
 * anvil runs with Base Sepolia's chain id 84532 and the canonical Permit2 runtime from contracts/test/fixtures (proven
 * byte-identical to Base Sepolia in S1 1.2); the Circle test-token addresses get placeholder code, because Deploy.s.sol
 * only checks that they exist. A fork of Base Sepolia was tried first and failed 2 runs in 6 on RPC latency.
 * Deploys v1 with throwaway keys into deployments/.test-keeper-<pid>/ (gitignored), then:
 * a 4-bid auction with keeper checkpoints, settle, exits (both kinds) and claims; a zero-bid lot; a chained truck lot
 * and carrier assignment; a no-show finalize; a release after the report window; and a second keeper rebuilt from
 * scratch that must send nothing. Needs Foundry (anvil, forge).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  maxUint160,
  maxUint256,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  agentRegistryAbi,
  continuousClearingAuctionAbi,
  iAllowanceTransferAbi,
  lotFactoryAbi,
  lotTokenAbi,
  marketSettlementAbi,
  mockStableAbi,
} from "@fairtown/shared/abi"
import { loadDeployment, type Deployment } from "@fairtown/shared/addresses"
import { ROLES, toKey } from "@fairtown/shared/keys"
import { ceilToTick, toQ96 } from "@fairtown/shared/units"
import { Keeper } from "../../src/keeper"
import { loadEnv, redact } from "../../src/lib"
import { TxQueue, viemSender } from "../../src/txQueue"
import { captureLogger } from "../fakes"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
// The test never uses .env values; they are only listed so nothing from .env could reach a log unredacted.
const { env } = loadEnv(`${ROOT}.env`)
const SECRETS = [env.RPC_URL, env.FORK_RPC_URL, env.KEEPER_PRIVATE_KEY]
const PERMIT2_CODE = readFileSync(join(ROOT, "contracts/test/fixtures/permit2.runtime.hex"), "utf8").trim() as Hex
const CIRCLE_TEST_TOKENS = [
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "0x808456652fdb597867f38412077A9182bf77359F",
] as const
const run = promisify(execFile)
const bin = (name: string) => {
  const local = join(homedir(), ".foundry", "bin", name)
  return existsSync(local) ? local : name
}
const WINDOWS = { contest: 20n, report: 60n, pickup: 100n }
const CHECKPOINT_EVERY = 10n
const dep_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const

/** Throwaway keys for this run only, kept beside their accounts so forge deploys with the same keys. */
const KEYS = new Map<string, string>()
function throwaway(): PrivateKeyAccount {
  const key = generatePrivateKey()
  const a = privateKeyToAccount(key)
  KEYS.set(a.address, key)
  return a
}
function keyOf(a: PrivateKeyAccount): string {
  const key = KEYS.get(a.address)
  if (!key) throw new Error("unknown test account")
  return key
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const a = s.address()
      s.close(() => (typeof a === "object" && a ? resolve(a.port) : reject(new Error("no port"))))
    })
  })
}

describe("keeper on a local anvil (S1 2.1)", () => {
  let anvil: ChildProcess | undefined
  let outDir = ""
  let dep: Deployment
  let pub: PublicClient
  let rpc = ""
  const k = throwaway
  const deployer = k()
  const operator = k()
  const keeperAcc = k()
  const restartedAcc = k() // a keeper restarted mid-window, on its own key (finalizeNoShow is permissionless)
  const treasury = k()
  const seller = k()
  const trucker = k()
  const buyers = { A: k(), B: k(), C: k(), D: k() }
  const cap = captureLogger(SECRETS)
  let keeper: Keeper
  let queue: TxQueue

  const test = () => createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(rpc) })
  const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: baseSepolia, transport: http(rpc) })
  async function send(hash: Promise<Hash>) {
    const r = await pub.waitForTransactionReceipt({ hash: await hash })
    expect(r.status).toBe("success")
    return r
  }
  async function mineTo(block: bigint) {
    const now = await pub.getBlockNumber({ cacheTime: 0 })
    if (now < block) await test().mine({ blocks: Number(block - now) })
  }
  const C = () => dep.contracts
  const sale = (lotId: bigint) =>
    pub.readContract({
      address: C().MarketSettlement as Address,
      abi: marketSettlementAbi,
      functionName: "saleOf",
      args: [lotId],
    })

  async function list(by: PrivateKeyAccount, spec: Record<string, unknown>) {
    const r = await send(
      wallet(by).writeContract({
        address: C().LotFactory as Address,
        abi: lotFactoryAbi,
        functionName: "createLot",
        args: [
          {
            sector: toKey("fish"),
            market: toKey("fish_dock"),
            commodity: toKey("cod"),
            grade: toKey("fresh_e"),
            place: toKey("bergen"),
            currency: C().TestEUR as Address,
            qty: 600n,
            floorPerUnit: 7_500_000n,
            durationBlocks: 90n,
            pickupWindowBlocks: WINDOWS.pickup,
            parentLotId: 0n,
            seller: by.address,
            metadataURI: "test://keeper",
            ...spec,
          } as never,
        ],
      }),
    )
    const [ev] = parseEventLogs({ abi: lotFactoryAbi, logs: r.logs, eventName: "LotListed" })
    const a = ev!.args
    for (const b of Object.values(buyers)) {
      await send(
        wallet(b).writeContract({
          address: dep.external.Permit2 as Address,
          abi: iAllowanceTransferAbi,
          functionName: "approve",
          args: [C().TestEUR as Address, a.auction, maxUint160, 281474976710655],
        }),
      )
    }
    return { lotId: a.lotId, auction: a.auction, token: a.token, endBlock: BigInt(a.endBlock) }
  }
  async function bid(b: PrivateKeyAccount, auction: Address, perUnit: bigint, amount: bigint) {
    const tick = await pub.readContract({
      address: auction,
      abi: continuousClearingAuctionAbi,
      functionName: "tickSpacing",
    })
    await send(
      wallet(b).writeContract({
        address: auction,
        abi: continuousClearingAuctionAbi,
        functionName: "submitBid",
        args: [ceilToTick(toQ96(perUnit), tick), amount, b.address, "0x"],
      }),
    )
  }
  const lastCp = (auction: Address) =>
    pub.readContract({ address: auction, abi: continuousClearingAuctionAbi, functionName: "lastCheckpointedBlock" })

  beforeAll(async () => {
    const port = await freePort()
    rpc = `http://127.0.0.1:${port}`
    anvil = spawn(bin("anvil"), ["--chain-id", "84532", "--port", String(port), "--silent"], { stdio: "ignore" })
    pub = createPublicClient({ transport: http(rpc, { retryCount: 0 }) })
    for (let i = 0; ; i++) {
      try {
        await pub.getChainId()
        break
      } catch (e) {
        // eslint-disable-next-line preserve-caught-error -- exit code only
        if (anvil.exitCode !== null) throw new Error(`anvil exited with code ${anvil.exitCode}`)
        // eslint-disable-next-line preserve-caught-error -- the raw cause can carry unredacted output
        if (i > 60) throw new Error(`anvil did not start: ${redact(String(e), SECRETS).slice(0, 300)}`)
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    await test().setCode({ address: dep_PERMIT2, bytecode: PERMIT2_CODE })
    for (const t of CIRCLE_TEST_TOKENS) await test().setCode({ address: t, bytecode: "0x00" }) // exists, unused
    for (const a of [deployer, operator, keeperAcc, restartedAcc, seller, trucker, ...Object.values(buyers)]) {
      await test().setBalance({ address: a.address, value: 10n ** 19n })
    }
    outDir = join(ROOT, "deployments", `.test-keeper-${process.pid}`)
    mkdirSync(outDir, { recursive: true })
    try {
      await run(bin("forge"), ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", rpc, "--broadcast"], {
        cwd: join(ROOT, "contracts"),
        timeout: 600_000,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          FOUNDRY_BROADCAST: join(outDir, "broadcast"), // keep committed broadcast records untouched
          DEPLOY_NETWORK: "anvil",
          DEPLOY_COMMIT: "keeper-test",
          DEPLOY_OUT: join(outDir, "anvil.json"),
          DEPLOYER_PRIVATE_KEY: keyOf(deployer),
          OPERATOR_PRIVATE_KEY: keyOf(operator),
          TREASURY_ADDRESS: treasury.address,
          CONTEST_WINDOW_BLOCKS: WINDOWS.contest.toString(),
          REPORT_WINDOW_BLOCKS: WINDOWS.report.toString(),
        },
      })
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      const tail = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.split("\n").slice(-30).join("\n")
      // eslint-disable-next-line preserve-caught-error -- the raw cause can carry unredacted output
      throw new Error(`forge deploy failed:\n${redact(tail, [...SECRETS, ...KEYS.values()])}`)
    }
    dep = await loadDeployment("anvil", pathToFileURL(`${outDir}/`))

    // Agents: seller, truck, four buyers, all with tEUR and a Permit2 approval.
    const reg = { address: C().AgentRegistry as Address, abi: agentRegistryAbi } as const
    const op = wallet(operator)
    await send(
      op.writeContract({ ...reg, functionName: "register", args: [seller.address, ROLES.SELLER, "test.seller"] }),
    )
    await send(
      op.writeContract({ ...reg, functionName: "register", args: [trucker.address, ROLES.TRUCK, "test.truck"] }),
    )
    for (const [n, b] of Object.entries(buyers)) {
      await send(
        op.writeContract({ ...reg, functionName: "register", args: [b.address, ROLES.BUYER, `test.buyer${n}`] }),
      )
      await send(
        op.writeContract({
          address: C().TestEUR as Address,
          abi: mockStableAbi,
          functionName: "mint",
          args: [b.address, 100_000_000_000n],
        }),
      )
      await send(
        wallet(b).writeContract({
          address: C().TestEUR as Address,
          abi: mockStableAbi,
          functionName: "approve",
          args: [dep.external.Permit2 as Address, maxUint256],
        }),
      )
    }

    queue = new TxQueue(viemSender(pub, wallet(keeperAcc)), cap.log, SECRETS, { pollMs: 50 })
    keeper = new Keeper({ pub, queue, dep, log: cap.log, checkpointEvery: CHECKPOINT_EVERY, secrets: SECRETS })
  }, 900_000)

  afterAll(() => {
    anvil?.kill()
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  let A: Awaited<ReturnType<typeof list>>
  let Z: Awaited<ReturnType<typeof list>>
  let T: Awaited<ReturnType<typeof list>>

  it("checkpoints a live auction with bids, not one without", async () => {
    Z = await list(seller, { durationBlocks: 10n }) // nobody bids
    A = await list(seller, {})
    await bid(buyers.A, A.auction, 7_650_000n, 500_000_000n) // outbid later
    await bid(buyers.C, A.auction, 8_000_000n, 1_000_000_000n) // at the final price
    await bid(buyers.B, A.auction, 8_000_000n, 8_000_000_000n) // pins the clearing price
    const before = await lastCp(A.auction)
    await test().mine({ blocks: Number(CHECKPOINT_EVERY) + 2 })
    await keeper.tick()
    expect(await lastCp(A.auction)).toBeGreaterThan(before)
    expect(cap.text()).toContain(`checkpoint lot ${A.lotId}`)
    expect(cap.text()).not.toContain(`checkpoint lot ${Z.lotId}`)
    await bid(buyers.D, A.auction, 10_000_000n, 1_000_000_000n) // above the final price
  }, 300_000)

  it("settles at endBlock (zero-bid lot too), exits every bid both ways, claims tokens", async () => {
    await mineTo(A.endBlock)
    await keeper.runUntilIdle()
    expect((await sale(A.lotId)).settled).toBe(true)
    const z = await sale(Z.lotId)
    expect(z.settled && z.soldTokens === 0n).toBe(true)
    const log = cap.text()
    expect(log).toContain("exitBid lot")
    expect(log).toContain("exitPartiallyFilledBid lot")
    expect(log).toContain("claimTokensBatch lot")
    let claimed = 0n
    for (let id = 0n; id < 4n; id++) {
      const b = await pub.readContract({
        address: A.auction,
        abi: continuousClearingAuctionAbi,
        functionName: "bids",
        args: [id],
      })
      expect(b.exitedBlock).toBeGreaterThan(0n)
      expect(b.tokensFilled).toBe(0n) // claimed
    }
    for (const b of Object.values(buyers)) {
      claimed += await pub.readContract({
        address: A.token,
        abi: lotTokenAbi,
        functionName: "balanceOf",
        args: [b.address],
      })
    }
    const s = await sale(A.lotId)
    expect(s.soldTokens - claimed).toBeLessThan(10n ** 12n) // CCA round-down dust only (D-46)
    expect(
      await pub.readContract({
        address: A.token,
        abi: lotTokenAbi,
        functionName: "balanceOf",
        args: [buyers.B.address],
      }),
    ).toBeGreaterThan(0n)
  }, 300_000)

  it("assigns the truck lot's seller as carrier when the chained truck lot settles", async () => {
    T = await list(trucker, {
      sector: toKey("truck"),
      market: toKey("freight_yard"),
      commodity: toKey("truck_capacity"),
      floorPerUnit: 1_000_000n,
      durationBlocks: 20n,
      parentLotId: A.lotId,
    })
    await bid(buyers.B, T.auction, 1_500_000n, 300_000_000n)
    await mineTo(T.endBlock)
    await keeper.runUntilIdle()
    expect((await sale(A.lotId)).carrier.toLowerCase()).toBe(trucker.address.toLowerCase())
    expect(cap.text()).toContain(`assignCarrier lot ${A.lotId} truck lot ${T.lotId}`)
  }, 300_000)

  it("finalizes an uncontested no-show only after the contest window", async () => {
    await mineTo((await sale(A.lotId)).pickupDeadline + 1n)
    const tokens = await pub.readContract({
      address: A.token,
      abi: lotTokenAbi,
      functionName: "balanceOf",
      args: [buyers.C.address],
    })
    expect(tokens).toBeGreaterThan(0n)
    const r = await send(
      wallet(buyers.C).writeContract({
        address: C().MarketSettlement as Address,
        abi: marketSettlementAbi,
        functionName: "reportNoShow",
        args: [A.lotId, tokens],
      }),
    )
    const [rep] = parseEventLogs({ abi: marketSettlementAbi, logs: r.logs, eventName: "NoShowReported" })
    const eurBefore = await pub.readContract({
      address: C().TestEUR as Address,
      abi: mockStableAbi,
      functionName: "balanceOf",
      args: [buyers.C.address],
    })
    await keeper.runUntilIdle()
    expect(cap.text()).not.toContain("finalizeNoShow lot")
    // A keeper (re)started now rebuilds from views (D-59): the open report exists only in events, and must be found
    // by the per-lot report-window scan.
    const q3 = new TxQueue(viemSender(pub, wallet(restartedAcc)), cap.log, SECRETS, { pollMs: 50 })
    const k3 = new Keeper({ pub, queue: q3, dep, log: cap.log, checkpointEvery: CHECKPOINT_EVERY, secrets: SECRETS })
    expect(await k3.runUntilIdle()).toBe(0)
    expect([...k3.state.reports.values()]).toEqual([
      {
        lotId: A.lotId,
        buyer: buyers.C.address.toLowerCase(),
        contestEnds: BigInt(rep!.args.contestEnds),
        contested: false,
      },
    ])
    await mineTo(BigInt(rep!.args.contestEnds) + 1n)
    expect(await k3.runUntilIdle()).toBe(1) // the restarted keeper finalizes it
    await keeper.runUntilIdle() // the first keeper sees it done (precheck), no revert
    expect(q3.stats).toMatchObject({ reverted: 0, failed: 0 })
    const [open] = await pub.readContract({
      address: C().MarketSettlement as Address,
      abi: marketSettlementAbi,
      functionName: "reportOf",
      args: [A.lotId, buyers.C.address],
    })
    expect(open).toBe(false)
    const eurAfter = await pub.readContract({
      address: C().TestEUR as Address,
      abi: mockStableAbi,
      functionName: "balanceOf",
      args: [buyers.C.address],
    })
    expect(eurAfter).toBeGreaterThan(eurBefore)
  }, 300_000)

  it("releases silent buyers' held share after the report window; nothing stays held", async () => {
    const a = await sale(A.lotId)
    const t = await sale(T.lotId)
    const last = a.pickupDeadline > t.pickupDeadline ? a.pickupDeadline : t.pickupDeadline
    await mineTo(last + WINDOWS.report + 1n)
    await keeper.runUntilIdle()
    for (const id of [A.lotId, T.lotId]) {
      const s = await sale(id)
      expect(s.released || s.complete).toBe(true)
      expect(s.heldRemaining).toBe(0n)
    }
    expect(cap.text()).toContain(`releaseExpired lot ${A.lotId}`)
  }, 300_000)

  it("running twice causes no reverts: a fresh keeper rebuilt from the chain sends nothing", async () => {
    expect(queue.stats.reverted).toBe(0)
    expect(queue.stats.failed).toBe(0)
    expect(await keeper.runUntilIdle()).toBe(0)
    const q2 = new TxQueue(viemSender(pub, wallet(keeperAcc)), cap.log, SECRETS, { pollMs: 50 })
    const k2 = new Keeper({ pub, queue: q2, dep, log: cap.log, checkpointEvery: CHECKPOINT_EVERY, secrets: SECRETS })
    expect(await k2.runUntilIdle()).toBe(0)
    expect(q2.stats).toMatchObject({ sent: 0, reverted: 0, failed: 0 })
    expect(k2.state.lots.size).toBe(3)
    for (const s of SECRETS) if (s) expect(cap.text()).not.toContain(s)
  }, 300_000)
})
