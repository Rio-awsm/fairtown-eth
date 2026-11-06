/**
 * S1 1.4 smoke: one real lot from listing to "paid in full", on the anvil fork or Base Sepolia.
 *   pnpm -F keeper smoke anvil          (needs `pnpm chain:fork` running and `pnpm deploy:anvil`)
 *   pnpm -F keeper smoke base-sepolia
 * Register, mint, Permit2, 100 kg cod for 300 blocks (~60 s; Base makes ~5 blocks/s), two bids, settle (assert advance), exit and claim,
 * seller-signed EIP-712 tickets, handovers (assert held paid), print explorer links.
 * Never prints keys, the mnemonic or the RPC URL. TEST MONEY only.
 */
import { fileURLToPath } from "node:url"
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
  type PrivateKeyAccount,
  type HDAccount,
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
import { HANDOVER_TYPES, handoverDomain } from "@fairtown/shared/handover"
import { ROLES, toKey } from "@fairtown/shared/keys"
import { ceilToTick, toQ96 } from "@fairtown/shared/units"
import {
  SMOKE_INDEX,
  SMOKE_MIN_GAS_WEI,
  addressLink,
  exitHints,
  expectedSettle,
  loadEnv,
  networkConfig,
  requireKey,
  requireMnemonic,
  safeErrorMessage,
  txLink,
} from "../src/lib"

const PAID_IN_FULL = 5
const root = fileURLToPath(new URL("../../../", import.meta.url))
const { env } = loadEnv(`${root}.env`)
// viem errors print the RPC URL; every failure goes through safeErrorMessage instead.
const onFail = (e: unknown) => {
  console.error(`SMOKE FAILED: ${safeErrorMessage(e, [env.RPC_URL, env.FORK_RPC_URL, env.ANVIL_RPC_URL])}`)
  process.exit(1)
}
process.on("unhandledRejection", onFail)
process.on("uncaughtException", onFail)
const cfg = networkConfig(process.argv[2], env)
const dep = await loadDeployment(cfg.network)
const C = dep.contracts
const PERMIT2 = dep.external.Permit2 as Address
const teur = C.TestEUR as Address

const transport = http(cfg.rpcUrl, { timeout: 30_000 })
const pub = createPublicClient({ chain: baseSepolia, transport, pollingInterval: 1_000 })
const deployer = privateKeyToAccount(requireKey(env, "DEPLOYER_PRIVATE_KEY"))
const operator = privateKeyToAccount(requireKey(env, "OPERATOR_PRIVATE_KEY"))
const keeper = privateKeyToAccount(requireKey(env, "KEEPER_PRIVATE_KEY"))
const mnemonic = requireMnemonic(env)
const seller = mnemonicToAccount(mnemonic, { addressIndex: SMOKE_INDEX.seller })
const buyers = [
  mnemonicToAccount(mnemonic, { addressIndex: SMOKE_INDEX.buyer1 }),
  mnemonicToAccount(mnemonic, { addressIndex: SMOKE_INDEX.buyer2 }),
]
const links: string[] = []

type Signer = PrivateKeyAccount | HDAccount
const wallet = (account: Signer) => createWalletClient({ account, chain: baseSepolia, transport })

let lastMark = Date.now()
const since = () => {
  const ms = Date.now() - lastMark
  lastMark = Date.now()
  return ms
}

async function send(label: string, hash: Hash) {
  const before = since()
  const r = await pub.waitForTransactionReceipt({ hash })
  if (process.env.SMOKE_TIMING) console.log(`  ..  ${label}: ${before} ms to send, ${since()} ms to receipt`)
  if (r.status !== "success") throw new Error(`${label} reverted: ${txLink(cfg.explorer, hash)}`)
  console.log(`  ok  ${label} (block ${r.blockNumber})`)
  links.push(`${label}: ${txLink(cfg.explorer, hash)}`)
  return r
}

async function waitForBlock(target: bigint) {
  if (cfg.network === "anvil") {
    const now = await pub.getBlockNumber()
    if (now < target) {
      await createTestClient({ chain: baseSepolia, mode: "anvil", transport }).mine({ blocks: Number(target - now) })
    }
    return
  }
  for (;;) {
    const now = await pub.getBlockNumber()
    if (now >= target) return
    process.stdout.write(`  ..  block ${now} -> ${target}\r`)
    await new Promise((r) => setTimeout(r, 2_000))
  }
}

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  console.log(`  ok  ${msg}`)
}

console.log(`Fairtown smoke on ${cfg.network} (TEST MONEY). Settlement ${C.MarketSettlement}`)

// 0. On the anvil fork only: gas for every wallet, set locally (anvil prices gas above Base Sepolia; real balances untouched).
if (cfg.network === "anvil") {
  const test = createTestClient({ chain: baseSepolia, mode: "anvil", transport })
  for (const a of [operator, keeper, seller, ...buyers]) {
    await test.setBalance({ address: a.address, value: 10n ** 18n })
  }
}

// 1. Base Sepolia: gas for the smoke wallets, topped up from the deployer only when low.
for (const a of cfg.network === "anvil" ? [] : [seller, ...buyers]) {
  const bal = await pub.getBalance({ address: a.address })
  if (bal < SMOKE_MIN_GAS_WEI) {
    await send(
      `gas -> ${a.address}`,
      await wallet(deployer).sendTransaction({ to: a.address, value: SMOKE_MIN_GAS_WEI - bal }),
    )
  }
}

// 2. Register seller and buyers; mint tEUR; Permit2 approval once per buyer.
const reg = { address: C.AgentRegistry as Address, abi: agentRegistryAbi } as const
for (const [a, role, name] of [
  [seller, ROLES.SELLER, "smoke.seller"],
  [buyers[0]!, ROLES.BUYER, "smoke.buyer1"],
  [buyers[1]!, ROLES.BUYER, "smoke.buyer2"],
] as const) {
  const current = await pub.readContract({ ...reg, functionName: "roleOf", args: [a.address] })
  if (current === 0) {
    await send(
      `register ${name}`,
      await wallet(operator).writeContract({ ...reg, functionName: "register", args: [a.address, role, name] }),
    )
  }
}
const amounts = [300_000_000n, 200_000_000n] // EUR 300 and EUR 200
for (const [i, b] of buyers.entries()) {
  const bal = await pub.readContract({
    address: teur,
    abi: mockStableAbi,
    functionName: "balanceOf",
    args: [b.address],
  })
  if (bal < amounts[i]!) {
    await send(
      `mint tEUR -> buyer${i + 1}`,
      await wallet(operator).writeContract({
        address: teur,
        abi: mockStableAbi,
        functionName: "mint",
        args: [b.address, 1_000_000_000n],
      }),
    )
  }
  const allowance = await pub.readContract({
    address: teur,
    abi: mockStableAbi,
    functionName: "allowance",
    args: [b.address, PERMIT2],
  })
  if (allowance < amounts[i]!) {
    await send(
      `buyer${i + 1} approve Permit2`,
      await wallet(b).writeContract({
        address: teur,
        abi: mockStableAbi,
        functionName: "approve",
        args: [PERMIT2, maxUint256],
      }),
    )
  }
}

// 3. The seller lists 100 kg of cod at EUR 7.50 for 20 blocks.
const listed = await send(
  "createLot 100 kg cod (300 blocks)",
  await wallet(seller).writeContract({
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
        qty: 100n,
        floorPerUnit: 7_500_000n,
        durationBlocks: 300n, // ~60 s at Base's ~200 ms blocks (D-50)
        pickupWindowBlocks: 3000n,
        parentLotId: 0n,
        seller: seller.address,
        metadataURI: "smoke://s1-1.4",
      },
    ],
  }),
)
const [lotEvent] = parseEventLogs({ abi: lotFactoryAbi, logs: listed.logs, eventName: "LotListed" })
if (!lotEvent) throw new Error("No LotListed event")
const { lotId, auction, token, endBlock } = lotEvent.args
const cca = { address: auction, abi: continuousClearingAuctionAbi } as const
console.log(`  lot ${lotId}, auction ${auction}, ends at block ${endBlock}`)

// 4. Two bids through Permit2, max EUR 8.00 per kg (demand EUR 500 < EUR 750 supply: both fill at the floor).
// The auction lasts 300 blocks (~60 s on Base Sepolia, ~200 ms blocks), so all four txs go out back to back with explicit gas
// (no simulation against a not-yet-mined allowance), then receipts are awaited together.
const tick = await pub.readContract({ ...cca, functionName: "tickSpacing" })
const maxPrice = ceilToTick(toQ96(8_000_000n), tick)
const pending: { label: string; hash: Hash }[] = []
console.log(
  `  ..  sending bids at block ${await pub.getBlockNumber()} (auction ${lotEvent.args.startBlock}..${endBlock})`,
)
for (const [i, b] of buyers.entries()) {
  const w = wallet(b)
  const nonce = await pub.getTransactionCount({ address: b.address, blockTag: "pending" })
  pending.push({
    label: `buyer${i + 1} Permit2 allowance`,
    hash: await w.writeContract({
      address: PERMIT2,
      abi: iAllowanceTransferAbi,
      functionName: "approve",
      args: [teur, auction, maxUint160, 281474976710655],
      gas: 120_000n,
      nonce,
    }),
  })
  pending.push({
    label: `buyer${i + 1} bid EUR ${Number(amounts[i]!) / 1e6}`,
    hash: await w.writeContract({
      ...cca,
      functionName: "submitBid",
      args: [maxPrice, amounts[i]!, b.address, "0x"],
      gas: 1_500_000n,
      nonce: nonce + 1,
    }),
  })
}
console.log(`  ..  all bids sent by block ${await pub.getBlockNumber()}`)
const bidIds: bigint[] = []
for (const t of pending) {
  const r = await send(t.label, t.hash)
  const [ev] = parseEventLogs({ abi: continuousClearingAuctionAbi, logs: r.logs, eventName: "BidSubmitted" })
  if (ev) bidIds.push(ev.args.id)
}
check(bidIds.length === 2, `both bids landed before block ${endBlock}`)

// 5. Settle at endBlock and check the advance.
await waitForBlock(endBlock)
const sellerBefore = await pub.readContract({
  address: teur,
  abi: mockStableAbi,
  functionName: "balanceOf",
  args: [seller.address],
})
const settled = await send(
  "settle",
  await wallet(keeper).writeContract({
    address: C.MarketSettlement as Address,
    abi: marketSettlementAbi,
    functionName: "settle",
    args: [lotId],
  }),
)
const [s] = parseEventLogs({ abi: marketSettlementAbi, logs: settled.logs, eventName: "LotSettled" })
if (!s) throw new Error("No LotSettled event")
const want = expectedSettle(s.args.raised, BigInt(dep.params.feeBps), BigInt(s.args.advanceBps))
// CCA rounds currencyRaised down: at most one base unit of dust per bid stays with the bidders (refunded on exit).
const dust = 500_000_000n - s.args.raised
check(
  dust >= 0n && dust <= BigInt(bidIds.length),
  `raised EUR ${Number(s.args.raised) / 1e6} (500.00 minus ${dust} base units of CCA dust)`,
)
check(
  s.args.sellerPaid === want.advance && s.args.held === want.held && s.args.fee === want.fee,
  "advance, held and fee match splitPayout",
)
const sellerAfterSettle = await pub.readContract({
  address: teur,
  abi: mockStableAbi,
  functionName: "balanceOf",
  args: [seller.address],
})
check(sellerAfterSettle - sellerBefore === want.advance, `seller got the advance EUR ${Number(want.advance) / 1e6}`)

// 6. Keeper exits and claims, so buyers hold lot tokens before the handover.
await send("checkpoint", await wallet(keeper).writeContract({ ...cca, functionName: "checkpoint" }))
const final = await pub.readContract({ ...cca, functionName: "clearingPrice" })
const last = await pub.readContract({ ...cca, functionName: "lastCheckpointedBlock" })
for (const id of bidIds) {
  const bid = await pub.readContract({ ...cca, functionName: "bids", args: [id] })
  if (bid.maxPrice > final) {
    await send(`exitBid ${id}`, await wallet(keeper).writeContract({ ...cca, functionName: "exitBid", args: [id] }))
  } else {
    const h = await exitHints(bid.maxPrice, BigInt(last), async (b) => {
      const cp = await pub.readContract({ ...cca, functionName: "checkpoints", args: [b] })
      return { block: b, clearingPrice: cp.clearingPrice, prev: BigInt(cp.prev) }
    })
    await send(
      `exitPartiallyFilledBid ${id}`,
      await wallet(keeper).writeContract({
        ...cca,
        functionName: "exitPartiallyFilledBid",
        args: [id, h.lastFullyFilled, h.outbid],
      }),
    )
  }
  await send(
    `claimTokens ${id}`,
    await wallet(keeper).writeContract({ ...cca, functionName: "claimTokens", args: [id] }),
  )
}

// 7. Seller signs a ticket per buyer (the QR); each buyer's own wallet confirms the handover.
const domain = handoverDomain(baseSepolia.id, C.MarketSettlement as Address)
const block = await pub.getBlockNumber()
for (const [i, b] of buyers.entries()) {
  const tokenAmount = await pub.readContract({
    address: token,
    abi: lotTokenAbi,
    functionName: "balanceOf",
    args: [b.address],
  })
  check(tokenAmount > 0n, `buyer${i + 1} holds ${Number(tokenAmount) / 1e18} kg of lot tokens`)
  const expiryBlock = block + 100n
  const sig = await wallet(seller).signTypedData({
    domain,
    types: HANDOVER_TYPES,
    primaryType: "Handover",
    message: { lotId, buyer: b.address, tokenAmount, expiryBlock },
  })
  await send(
    `buyer${i + 1} confirmHandover`,
    await wallet(b).writeContract({
      address: C.MarketSettlement as Address,
      abi: marketSettlementAbi,
      functionName: "confirmHandover",
      args: [lotId, b.address, tokenAmount, expiryBlock, sig],
    }),
  )
}

// 8. The rest is paid and the lot is closed.
const sellerEnd = await pub.readContract({
  address: teur,
  abi: mockStableAbi,
  functionName: "balanceOf",
  args: [seller.address],
})
check(
  sellerEnd - sellerBefore === want.advance + want.held,
  `seller got advance + held = EUR ${Number(want.advance + want.held) / 1e6}`,
)
const [held] = await pub.readContract({
  address: C.MarketSettlement as Address,
  abi: marketSettlementAbi,
  functionName: "heldOf",
  args: [lotId],
})
check(held === 0n, "nothing left held")
const status = await pub.readContract({
  address: C.MarketSettlement as Address,
  abi: marketSettlementAbi,
  functionName: "statusOf",
  args: [lotId],
})
check(status === PAID_IN_FULL, "status paid_in_full")

console.log("\nSMOKE PASSED. Links:")
console.log(`  MarketSettlement: ${addressLink(cfg.explorer, C.MarketSettlement)}`)
console.log(`  Lot ${lotId} auction: ${addressLink(cfg.explorer, auction)}`)
for (const l of links) console.log(`  ${l}`)
