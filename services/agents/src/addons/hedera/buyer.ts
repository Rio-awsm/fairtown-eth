import { x402Client } from "@x402/core/client"
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http"
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types"
import { createClientHederaSigner } from "@x402/hedera"
import { ExactHederaScheme } from "@x402/hedera/exact/client"
import { PrivateKey } from "@hiero-ledger/sdk"
import { formatUnits } from "viem"
import { HEDERA_TESTNET_USDC, hashscanTx, type Intel } from "./intel"

export type SpendPolicy = {
  allowHosts: string[] // only pay these merchants' hosts
  allowPayTo: string[] // and only to these Hedera accounts
  maxPerCall: Record<string, bigint> // atomic units per asset id
  budgetPerAgent: Record<string, bigint> // atomic units per asset id, per agent, for the run
}
export type Receipt = { agentId: string; commodity: string; asset: string; amount: string; transaction: string; hashscan: string; at: string }
export type BuyResult = { ok: true; intel: Intel; receipt?: Receipt } | { ok: false; reason: string }

export const DEFAULT_POLICY = (payTo: string, host: string): SpendPolicy => ({
  allowHosts: [host],
  allowPayTo: [payTo],
  maxPerCall: { [HEDERA_TESTNET_USDC]: 50_000n, "0.0.0": 20_000_000n }, // 0.05 USDC, 0.2 HBAR
  budgetPerAgent: { [HEDERA_TESTNET_USDC]: 200_000n, "0.0.0": 100_000_000n }, // 0.20 USDC, 1 HBAR
})

const PREFER = [HEDERA_TESTNET_USDC, "0.0.0"]
const hostOf = (url: string) => new URL(url).host

export function hederaClient(accountId: string, privateKey: string) {
  const k = privateKey.trim().startsWith("30") ? PrivateKey.fromStringDer(privateKey.trim()) : PrivateKey.fromStringECDSA(privateKey.trim())
  // The library's own cap is a second guard behind our policy.
  return new x402Client().register("hedera:*", new ExactHederaScheme(createClientHederaSigner(accountId, k, { network: "hedera:testnet" }))).setSpendControls({ maxAmountPerPayment: "$0.10", allowedAssets: true })
}

// Buyer agents pay per call for market intel, with no human: discover the price, check the policy, pay, read.
export class IntelBuyer {
  readonly receipts: Receipt[] = []
  private readonly spent = new Map<string, Map<string, bigint>>()
  private readonly cache = new Map<string, { at: number; v: Intel }>()

  constructor(
    private readonly o: {
      client: Pick<x402Client, "createPaymentPayload">
      policy: SpendPolicy
      balanceOf?: (asset: string) => Promise<bigint> // skip prices the payer can't cover
      fetch?: typeof fetch
      now?: () => number
      cacheMs?: number
    },
  ) {}

  spentBy(agentId: string) {
    return Object.fromEntries(this.spent.get(agentId) ?? new Map())
  }

  // Pick the first accepted price the policy allows, preferring USDC.
  choose(agentId: string, pr: PaymentRequired, balances: Record<string, bigint> = {}): PaymentRequirements | string {
    const p = this.o.policy
    const used = this.spent.get(agentId) ?? new Map<string, bigint>()
    const reasons: string[] = []
    const ok = pr.accepts.filter((r) => {
      const amt = BigInt(r.amount)
      if (!p.allowPayTo.includes(r.payTo)) return reasons.push(`payTo ${r.payTo} not allowed`), false
      const cap = p.maxPerCall[r.asset]
      if (cap === undefined) return reasons.push(`asset ${r.asset} not allowed`), false
      if (amt > cap) return reasons.push(`${r.asset} price ${amt} over per-call cap ${cap}`), false
      if ((used.get(r.asset) ?? 0n) + amt > (p.budgetPerAgent[r.asset] ?? 0n)) return reasons.push(`${r.asset} budget used`), false
      if (r.asset in balances && balances[r.asset]! < amt) return reasons.push(`holds ${balances[r.asset]} of ${r.asset}, needs ${amt}`), false
      return true
    })
    ok.sort((a, b) => PREFER.indexOf(a.asset) - PREFER.indexOf(b.asset))
    return ok[0] ?? (reasons.join("; ") || "no accepted price")
  }

  async buy(agentId: string, url: string, commodity: string): Promise<BuyResult> {
    const f = this.o.fetch ?? fetch
    const now = this.o.now ?? Date.now
    const hit = this.cache.get(commodity)
    if (hit && now() - hit.at < (this.o.cacheMs ?? 5 * 60_000)) return { ok: true, intel: hit.v }
    if (!this.o.policy.allowHosts.includes(hostOf(url))) return { ok: false, reason: `host ${hostOf(url)} not allowed` }
    const first = await f(url)
    if (first.ok) return { ok: true, intel: (await first.json()) as Intel }
    if (first.status !== 402) return { ok: false, reason: `merchant HTTP ${first.status}` }
    const header = first.headers.get("payment-required")
    if (!header) return { ok: false, reason: "402 without PAYMENT-REQUIRED" }
    const pr = decodePaymentRequiredHeader(header)
    const balances: Record<string, bigint> = {}
    if (this.o.balanceOf) for (const r of pr.accepts) balances[r.asset] = await this.o.balanceOf(r.asset).catch(() => 0n)
    const chosen = this.choose(agentId, pr, balances)
    if (typeof chosen === "string") return { ok: false, reason: `refused: ${chosen}` }
    const payload = await this.o.client.createPaymentPayload({ ...pr, accepts: [chosen] })
    const paid = await f(url, { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) } })
    if (!paid.ok) return { ok: false, reason: `payment rejected: HTTP ${paid.status} ${(await paid.text()).slice(0, 160)}` }
    const settle = decodePaymentResponseHeader(paid.headers.get("payment-response") ?? "")
    const intel = (await paid.json()) as Intel
    const used = this.spent.get(agentId) ?? new Map<string, bigint>()
    used.set(chosen.asset, (used.get(chosen.asset) ?? 0n) + BigInt(chosen.amount))
    this.spent.set(agentId, used)
    const receipt: Receipt = { agentId, commodity, asset: chosen.asset, amount: chosen.amount, transaction: settle.transaction, hashscan: hashscanTx(settle.transaction), at: new Date(now()).toISOString() }
    this.receipts.push(receipt)
    this.cache.set(commodity, { at: now(), v: intel })
    return { ok: true, intel, receipt }
  }
}

// One line for the bidder's prompt. Paid intel informs the decision; guardrails still decide what reaches the chain.
export function intelLine(i: Intel, currencyOf: (c: string) => string = () => ""): string {
  const fmt = (v: string) => formatUnits(BigInt(v), 6)
  const median = i.medianClear ? `median clear ${fmt(i.medianClear)} over ${i.recentClears.length} lots` : "no clears yet"
  const cur = i.recentClears[0]?.currency ?? currencyOf(i.commodity)
  return `Paid intel (Hedera x402): ${median}${cur ? ` (${cur})` : ""}; ${i.sellersWithNoShows.length} seller(s) with no-shows; ${i.signals.length ? i.signals.map((s) => s.label).join("; ") : "no live signals"}.`
}

// Payer balances from the Hedera mirror node: HBAR in tinybars ("0.0.0"), HTS tokens in their atomic units.
export function mirrorBalances(accountId: string, f: typeof fetch = fetch) {
  return async (asset: string): Promise<bigint> => {
    const r = (await (await f(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`)).json()) as { balance?: { balance?: number; tokens?: Array<{ token_id: string; balance: number }> } }
    if (asset === "0.0.0") return BigInt(r.balance?.balance ?? 0)
    return BigInt(r.balance?.tokens?.find((t) => t.token_id === asset)?.balance ?? 0)
  }
}
