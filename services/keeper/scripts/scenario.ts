/**
 * S1 2.1 live run: sets up a market day and checks that a separately running keeper does every follow-up step.
 *   terminal 1: pnpm -F keeper dev base-sepolia
 *   terminal 2: pnpm -F keeper scenario base-sepolia      (or anvil; this script then mines while it waits)
 * This script lists and bids only. It never calls settle, exit, claim, assignCarrier, finalizeNoShow or
 * releaseExpired: it waits for the keeper to do them and prints the keeper's transactions.
 *   1. 600 kg cod, 4 bids (one outbid, two at the final price, one above) -> keeper settles, exits, claims
 *   2. a truck lot chained to it -> keeper settles it and assigns the carrier
 *   3. a buyer reports a no-show -> keeper finalizes it after the contest window (~2 min)
 *   4. silent buyers -> keeper releases the held share after the report window (~10 min)
 * Wallets: AGENT_MNEMONIC indexes 90 (seller), 91 to 94 (buyers), 95 (truck) (D-49). TEST MONEY only.
 */
import { fileURLToPath } from "node:url"
import {
  BaseError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  maxUint160,
  maxUint256,
  parseEventLogs,
  type Address,
  type Hash,
  type HDAccount,
  type PrivateKeyAccount,
} from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import {
  agentRegistryAbi,
  continuousClearingAuctionAbi,
  iAllowanceTransferAbi,
  lotFactoryAbi,
  lotTokenAbi,
  marketSettlementAbi,
  mockStableAbi,
} from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { ROLES, toKey } from "@fairtown/shared/keys"
import { ceilToTick, toQ96 } from "@fairtown/shared/units"
import {
  SMOKE_MIN_GAS_WEI,
  addressLink,
  loadEnv,
  networkConfig,
  requireKey,
  requireMnemonic,
  safeErrorMessage,
  shrinkLogChunk,
  txLink,
} from "../src/lib"

export const SCENARIO_INDEX = { seller: 90, buyers: [91, 92, 93, 94], truck: 95 } as const
const STAGE_TIMEOUT_MS = 5 * 60_000

const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
const onFail = (e: unknown) => {
  console.error(`SCENARIO FAILED: ${safeErrorMessage(e, [env.RPC_URL, env.FORK_RPC_URL, env.ANVIL_RPC_URL])}`)
  process.exit(1)
}
process.on("unhandledRejection", onFail)
process.on("uncaughtException", onFail)
const cfg = networkConfig(process.argv[2], env)
const dep = await loadDeployment(cfg.network)
const C = dep.contracts
const teur = C.TestEUR as Address
const settlement = { address: C.MarketSettlement as Address, abi: marketSettlementAbi } as const
const transport = http(cfg.rpcUrl, { timeout: 30_000 })
const pub = createPublicClient({ transport, pollingInterval: 1_000 })
const anvilTest = cfg.network === "anvil" ? createTestClient({ chain: baseSepolia, mode: "anvil", transport }) : null
const deployer = privateKeyToAccount(requireKey(env, "DEPLOYER_PRIVATE_KEY"))
const operator = privateKeyToAccount(requireKey(env, "OPERATOR_PRIVATE_KEY"))
const mnemonic = requireMnemonic(env)
const seller = mnemonicToAccount(mnemonic, { addressIndex: SCENARIO_INDEX.seller })
const [bA, bB, bC, bD] = SCENARIO_INDEX.buyers.map((i) => mnemonicToAccount(mnemonic, { addressIndex: i }))
const buyers = [bA!, bB!, bC!, bD!]
const trucker = mnemonicToAccount(mnemonic, { addressIndex: SCENARIO_INDEX.truck })
type Signer = PrivateKeyAccount | HDAccount
const wallet = (a: Signer) => createWalletClient({ account: a, chain: baseSepolia, transport })

async function send(label: string, hash: Hash) {
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== "success") throw new Error(`${label} reverted: ${txLink(cfg.explorer, hash)}`)
  console.log(`  ok  ${label} (block ${r.blockNumber})`)
  return r
}

/** Polls until `check` returns a value; on anvil, mines blocks so deadlines pass. */
async function waitFor<T>(
  label: string,
  check: () => Promise<T | undefined | false>,
  timeoutMs = STAGE_TIMEOUT_MS,
): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await check()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for the keeper: ${label}`)
    if (anvilTest) await anvilTest.mine({ blocks: 20 })
    process.stdout.write(`  ..  waiting for keeper: ${label} (block ${await pub.getBlockNumber({ cacheTime: 0 })})\r`)
    await new Promise((r) => setTimeout(r, 2_000))
  }
}

/**
 * The keeper's transaction for an event, for the explorer link. Searches back from the head in windows under the
 * RPC's getLogs limit (some providers allow only 200 blocks), shrinking the window if the RPC still refuses.
 */
let logWindow = 200n
async function keeperTx(eventName: string, args: Record<string, unknown>, fromBlock: bigint) {
  let to = await pub.getBlockNumber({ cacheTime: 0 })
  while (to >= fromBlock) {
    const from = to - logWindow + 1n > fromBlock ? to - logWindow + 1n : fromBlock
    try {
      const logs = await pub.getContractEvents({
        ...settlement,
        eventName,
        args,
        fromBlock: from,
        toBlock: to,
      } as never)
      const l = (logs as { transactionHash: Hash }[]).at(-1)
      if (l) return txLink(cfg.explorer, l.transactionHash)
      to = from - 1n
    } catch (e) {
      const next = shrinkLogChunk(
        e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : String(e),
        logWindow,
        10n,
      )
      if (next === undefined) throw e
      logWindow = next
    }
  }
  return "(not found)"
}

console.log(`Fairtown keeper scenario on ${cfg.network} (TEST MONEY). Settlement ${C.MarketSettlement}`)

// 0. Gas, roles, tEUR and Permit2 approvals for every wallet (idempotent).
const everyone = [seller, trucker, ...buyers]
for (const a of everyone) {
  if (anvilTest) await anvilTest.setBalance({ address: a.address, value: 10n ** 18n })
  else {
    const bal = await pub.getBalance({ address: a.address })
    if (bal < SMOKE_MIN_GAS_WEI) {
      await send(
        `gas -> ${a.address}`,
        await wallet(deployer).sendTransaction({ to: a.address, value: SMOKE_MIN_GAS_WEI - bal }),
      )
    }
  }
}
const reg = { address: C.AgentRegistry as Address, abi: agentRegistryAbi } as const
for (const [a, role, name] of [
  [seller, ROLES.SELLER, "scenario.seller"],
  [trucker, ROLES.TRUCK, "scenario.truck"],
  ...buyers.map((b, i) => [b, ROLES.BUYER, `scenario.buyer${i + 1}`] as const),
] as const) {
  if ((await pub.readContract({ ...reg, functionName: "roleOf", args: [a.address] })) === 0) {
    await send(
      `register ${name}`,
      await wallet(operator).writeContract({ ...reg, functionName: "register", args: [a.address, role, name] }),
    )
  }
}
const tok = { address: teur, abi: mockStableAbi } as const
for (const [i, b] of buyers.entries()) {
  if ((await pub.readContract({ ...tok, functionName: "balanceOf", args: [b.address] })) < 10_000_000_000n) {
    await send(
      `mint tEUR -> buyer${i + 1}`,
      await wallet(operator).writeContract({ ...tok, functionName: "mint", args: [b.address, 20_000_000_000n] }),
    )
  }
  if (
    (await pub.readContract({
      ...tok,
      functionName: "allowance",
      args: [b.address, dep.external.Permit2 as Address],
    })) < 10_000_000_000n
  ) {
    await send(
      `buyer${i + 1} approve Permit2`,
      await wallet(b).writeContract({
        ...tok,
        functionName: "approve",
        args: [dep.external.Permit2 as Address, maxUint256],
      }),
    )
  }
}

async function list(by: Signer, spec: Record<string, unknown>, label: string) {
  const r = await send(
    label,
    await wallet(by).writeContract({
      address: C.LotFactory as Address,
      abi: lotFactoryAbi,
      functionName: "createLot",
      args: [
        {
          sector: toKey("fish"),
          market: toKey("fish_dock"),
          commodity: toKey("cod"),
          grade: toKey("fresh_e"),
          place: toKey("bergen"),
          currency: teur,
          qty: 600n,
          floorPerUnit: 7_500_000n,
          durationBlocks: 450n, // D-50 fish auction, ~90 s
          pickupWindowBlocks: 300n, // short, so the no-show and release stages finish in minutes
          parentLotId: 0n,
          seller: by.address,
          metadataURI: "scenario://s1-2.1",
          ...spec,
        } as never,
      ],
    }),
  )
  const [ev] = parseEventLogs({ abi: lotFactoryAbi, logs: r.logs, eventName: "LotListed" })
  if (!ev) throw new Error("No LotListed event")
  return { ...ev.args, listedAt: r.blockNumber }
}

async function bid(b: Signer, auction: Address, perUnit: bigint, amount: bigint, label: string) {
  const w = wallet(b)
  await send(
    `${label} Permit2 allowance`,
    await w.writeContract({
      address: dep.external.Permit2 as Address,
      abi: iAllowanceTransferAbi,
      functionName: "approve",
      args: [teur, auction, maxUint160, 281474976710655],
    }),
  )
  const tick = await pub.readContract({
    address: auction,
    abi: continuousClearingAuctionAbi,
    functionName: "tickSpacing",
  })
  await send(
    `${label} bid max EUR ${Number(perUnit) / 1e6}/kg, EUR ${Number(amount) / 1e6}`,
    await w.writeContract({
      address: auction,
      abi: continuousClearingAuctionAbi,
      functionName: "submitBid",
      args: [ceilToTick(toQ96(perUnit), tick), amount, b.address, "0x"],
      gas: 1_500_000n,
    }),
  )
}
const saleOf = (lotId: bigint) => pub.readContract({ ...settlement, functionName: "saleOf", args: [lotId] })

// 1. The cod lot and four bids.
const L = await list(seller, {}, "createLot 600 kg cod")
console.log(`  lot ${L.lotId}: ${addressLink(cfg.explorer, L.auction)}, ends at block ${L.endBlock}`)
await bid(bA!, L.auction, 7_650_000n, 500_000_000n, "buyer1 (outbid later)")
await bid(bC!, L.auction, 8_000_000n, 1_000_000_000n, "buyer3 (at final)")
await bid(bB!, L.auction, 8_000_000n, 8_000_000_000n, "buyer2 (pins the price)")
await bid(bD!, L.auction, 10_000_000n, 1_000_000_000n, "buyer4 (above final)")
await waitFor("settle", async () => (await saleOf(L.lotId)).settled)
console.log(`\n  ok  keeper settled lot ${L.lotId}: ${await keeperTx("LotSettled", { lotId: L.lotId }, L.listedAt)}`)
await waitFor("exits and claims", async () => {
  for (let id = 0n; id < 4n; id++) {
    const b = await pub.readContract({
      address: L.auction,
      abi: continuousClearingAuctionAbi,
      functionName: "bids",
      args: [id],
    })
    if (b.exitedBlock === 0n || b.tokensFilled > 0n) return false
  }
  return true
})
for (const [i, b] of buyers.entries()) {
  const t = await pub.readContract({ address: L.token, abi: lotTokenAbi, functionName: "balanceOf", args: [b.address] })
  console.log(`\n  ok  buyer${i + 1} holds ${Number(t) / 1e18} kg (keeper exited and claimed)`)
}

// 2. The truck lot chained to it.
const T = await list(
  trucker,
  {
    sector: toKey("truck"),
    market: toKey("freight_yard"),
    commodity: toKey("truck_capacity"),
    grade: toKey("na"),
    floorPerUnit: 1_000_000n,
    durationBlocks: 300n,
    parentLotId: L.lotId,
  },
  "createLot truck 600 kg_route (parent)",
)
await bid(bB!, T.auction, 1_500_000n, 300_000_000n, "buyer2 books the truck")
const carrier = await waitFor("assignCarrier", async () => {
  const c = (await saleOf(L.lotId)).carrier
  return c.toLowerCase() === trucker.address.toLowerCase() ? c : undefined
})
console.log(
  `\n  ok  keeper assigned carrier ${carrier}: ${await keeperTx("CarrierAssigned", { lotId: L.lotId }, T.listedAt)}`,
)

// 3. No-show: buyer3 reports after the pickup deadline; the keeper finalizes after the contest window.
const deadline = (await saleOf(L.lotId)).pickupDeadline
await waitFor(
  `pickup deadline ${deadline}`,
  async () => (await pub.getBlockNumber({ cacheTime: 0 })) > BigInt(deadline),
)
const cTokens = await pub.readContract({
  address: L.token,
  abi: lotTokenAbi,
  functionName: "balanceOf",
  args: [bC!.address],
})
const rep = await send(
  "buyer3 reportNoShow",
  await wallet(bC!).writeContract({ ...settlement, functionName: "reportNoShow", args: [L.lotId, cTokens] }),
)
const [nr] = parseEventLogs({ abi: marketSettlementAbi, logs: rep.logs, eventName: "NoShowReported" })
console.log(`  ..  contest window ends at block ${nr?.args.contestEnds}`)
await waitFor("finalizeNoShow", async () => {
  const [open] = await pub.readContract({ ...settlement, functionName: "reportOf", args: [L.lotId, bC!.address] })
  return !open
})
console.log(`\n  ok  keeper refunded buyer3: ${await keeperTx("NoShowRefunded", { lotId: L.lotId }, rep.blockNumber)}`)

// 4. Release after the report window: silent buyers' share goes to the seller.
const reportEnds = BigInt(deadline) + BigInt(dep.params.reportWindowBlocks)
console.log(`  ..  report window ends at block ${reportEnds} (~10 min)`)
// The window itself is ~10 min (3000 blocks), longer than the per-stage timeout: wait for it first (allowing
// blocks at 2 per second, slower than Base's ~5/s), then give the keeper the usual stage timeout.
const blocksLeft = reportEnds - (await pub.getBlockNumber({ cacheTime: 0 }))
await waitFor(
  `report window end ${reportEnds}`,
  async () => (await pub.getBlockNumber({ cacheTime: 0 })) > reportEnds,
  (Number(blocksLeft > 0n ? blocksLeft : 0n) / 2) * 1_000 + STAGE_TIMEOUT_MS,
)
await waitFor("releaseExpired", async () => {
  const s = await saleOf(L.lotId)
  return s.released || s.complete
})
const end = await saleOf(L.lotId)
console.log(
  `\n  ok  keeper released lot ${L.lotId}: ${await keeperTx("HeldReleased", { lotId: L.lotId }, rep.blockNumber)}`,
)
if (end.heldRemaining !== 0n) throw new Error(`EUR ${Number(end.heldRemaining) / 1e6} still held on lot ${L.lotId}`)
console.log(
  `\nSCENARIO PASSED. Nothing held on lot ${L.lotId}. Settlement: ${addressLink(cfg.explorer, C.MarketSettlement)}`,
)
process.exit(0)
