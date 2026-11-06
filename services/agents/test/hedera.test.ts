import { x402Client } from "@x402/core/client"
import { decodePaymentRequiredHeader } from "@x402/core/http"
import type { FacilitatorClient } from "@x402/core/server"
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import Fastify from "fastify"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_POLICY, IntelBuyer, intelLine } from "../src/addons/hedera/buyer"
import { HEDERA_TESTNET_USDC, hashscanTx, intelServer, registerIntelRoute } from "../src/addons/hedera/intel"
import { MemoryArkivStore } from "../src/arkiv/MemoryArkivStore"

const MERCHANT = "0.0.11335541"

// Stand-in facilitator: checks the payer signed for the exact requirement, settles with a Hedera-style tx id.
function fakeFacilitator(opts: { valid?: boolean; settle?: boolean } = {}) {
  const seen = { verify: 0, settle: 0 }
  const f: FacilitatorClient = {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.9185802" } }], extensions: [], signers: {} }
    },
    async verify(p: PaymentPayload, r: PaymentRequirements) {
      seen.verify++
      const ok = (opts.valid ?? true) && (p.payload as { signedFor?: string }).signedFor === `${r.asset}:${r.amount}:${r.payTo}`
      return ok ? { isValid: true, payer: "0.0.11335677" } : { isValid: false, invalidReason: "bad_signature" }
    },
    async settle(_p: PaymentPayload, r: PaymentRequirements) {
      seen.settle++
      return opts.settle === false
        ? { success: false, errorReason: "insufficient_balance", transaction: "", network: r.network }
        : { success: true, transaction: "0.0.9185802@1793948661.406575988", network: r.network, payer: "0.0.11335677" }
    },
  }
  return { f, seen }
}

// Stand-in payer: "signs" the requirement it was given (the real one builds a Hedera transfer for the facilitator).
const fakePayer = () =>
  new x402Client().register("hedera:*", {
    scheme: "exact",
    async createPaymentPayload(x402Version, r) {
      return { x402Version, payload: { signedFor: `${r.asset}:${r.amount}:${r.payTo}` } }
    },
  }).setSpendControls(false)

const apps: Array<{ close: () => Promise<unknown> }> = []
afterEach(async () => {
  while (apps.length) await apps.pop()!.close()
})

async function merchant(facilitator: FacilitatorClient) {
  const arkiv = new MemoryArkivStore()
  for (const [lotId, p] of [[1n, 9_100_000n], [2n, 8_700_000n], [3n, 9_300_000n]] as const)
    await arkiv.put(ARKIV_SCHEMAS.price, { sector: "fish", commodity: "cod", grade: "fresh_a", market: "fish_dock", place: "bergen", currency: "EUR", lotId, finalClearingPerUnit: p, avgPerUnit: p, soldUnits: 600n, day: "2026-11-06", tx: "0x" }, { owner: "0x00000000000000000000000000000000000000ee", expiresInSeconds: 3600 })
  await arkiv.put(ARKIV_SCHEMAS.reputation, { seller: "0x00000000000000000000000000000000000000c1", tier: "new", cleanLots: 0n, noShows: 1n, day: "2026-11-06", lastLotId: 2n, tx: "0x" }, { owner: "0x00000000000000000000000000000000000000ee", expiresInSeconds: 3600 })
  const app = Fastify({ logger: false })
  const settled: string[] = []
  registerIntelRoute(app, { server: intelServer("http://unused", facilitator), payTo: MERCHANT, arkiv, onSettled: (tx) => settled.push(tx) })
  await app.listen({ port: 0, host: "127.0.0.1" })
  apps.push(app)
  return { host: `127.0.0.1:${(app.server.address() as AddressInfo).port}`, settled }
}

describe("x402 intel on Hedera (mocked facilitator)", () => {
  it("answers 402 with USDC and HBAR prices to the merchant account", async () => {
    const { host } = await merchant(fakeFacilitator().f)
    const r = await fetch(`http://${host}/api/intel/cod`)
    expect(r.status).toBe(402)
    const pr = decodePaymentRequiredHeader(r.headers.get("payment-required")!)
    expect(pr.accepts.map((a) => [a.network, a.asset, a.amount, a.payTo])).toEqual([
      ["hedera:testnet", HEDERA_TESTNET_USDC, "10000", MERCHANT],
      ["hedera:testnet", "0.0.0", "5000000", MERCHANT],
    ])
    expect(pr.accepts[0]!.extra).toMatchObject({ feePayer: "0.0.9185802" })
    expect((await fetch(`http://${host}/api/intel/unobtainium`)).status).toBe(404)
  })

  it("an agent discovers the price, pays within policy, gets the intel and a settled tx, with no human", async () => {
    const { f, seen } = fakeFacilitator()
    const { host, settled } = await merchant(f)
    const buyer = new IntelBuyer({ client: fakePayer(), policy: DEFAULT_POLICY(MERCHANT, host) })
    const r = await buyer.buy("hanse_kitchen", `http://${host}/api/intel/cod`, "cod")
    if (!r.ok) throw new Error(r.reason)
    expect(r.intel).toMatchObject({ commodity: "cod", medianClear: "9100000", sellersWithNoShows: [{ noShows: 1 }] })
    expect(r.intel.recentClears).toHaveLength(3)
    expect(r.receipt).toMatchObject({ asset: HEDERA_TESTNET_USDC, amount: "10000", transaction: "0.0.9185802@1793948661.406575988" })
    expect(r.receipt!.hashscan).toBe("https://hashscan.io/testnet/transaction/0.0.9185802-1793948661-406575988")
    expect(settled).toEqual(["0.0.9185802@1793948661.406575988"])
    expect(seen).toEqual({ verify: 1, settle: 1 })
    expect(buyer.spentBy("hanse_kitchen")).toEqual({ [HEDERA_TESTNET_USDC]: 10000n })
    expect(intelLine(r.intel)).toBe("Paid intel (Hedera x402): median clear 9.1 over 3 lots (EUR); 1 seller(s) with no-shows; no live signals.")
    const again = await buyer.buy("hanse_kitchen", `http://${host}/api/intel/cod`, "cod") // cached: no second payment
    expect(again.ok && again.receipt).toBeFalsy()
    expect(seen.settle).toBe(1)
  })

  it("falls back to HBAR when the payer holds no USDC", async () => {
    const { host } = await merchant(fakeFacilitator().f)
    const buyer = new IntelBuyer({ client: fakePayer(), policy: DEFAULT_POLICY(MERCHANT, host), balanceOf: async (a) => (a === "0.0.0" ? 2_500_000_000n : 0n) })
    const r = await buyer.buy("atlas_labs", `http://${host}/api/intel/gpu_hour`, "gpu_hour")
    expect(r.ok && r.receipt?.asset).toBe("0.0.0")
  })

  it("blocks on budget, per-call cap, unknown payee and unknown host, before paying", async () => {
    const { f, seen } = fakeFacilitator()
    const { host } = await merchant(f)
    const tight = { ...DEFAULT_POLICY(MERCHANT, host), budgetPerAgent: { [HEDERA_TESTNET_USDC]: 15_000n, "0.0.0": 0n } }
    const buyer = new IntelBuyer({ client: fakePayer(), policy: tight, cacheMs: 0 })
    expect((await buyer.buy("a1", `http://${host}/api/intel/cod`, "cod")).ok).toBe(true)
    const second = await buyer.buy("a1", `http://${host}/api/intel/tomato`, "tomato")
    expect(second).toEqual({ ok: false, reason: expect.stringContaining(`${HEDERA_TESTNET_USDC} budget used`) })
    expect((await buyer.buy("a2", `http://${host}/api/intel/tomato`, "tomato")).ok).toBe(true) // budgets are per agent

    const capped = new IntelBuyer({ client: fakePayer(), policy: { ...DEFAULT_POLICY(MERCHANT, host), maxPerCall: { [HEDERA_TESTNET_USDC]: 1n, "0.0.0": 1n } } })
    expect(await capped.buy("a3", `http://${host}/api/intel/cod`, "cod")).toMatchObject({ ok: false, reason: expect.stringContaining("over per-call cap") })
    const stranger = new IntelBuyer({ client: fakePayer(), policy: { ...DEFAULT_POLICY("0.0.999", host) } })
    expect(await stranger.buy("a4", `http://${host}/api/intel/cod`, "cod")).toMatchObject({ ok: false, reason: expect.stringContaining("not allowed") })
    const offList = new IntelBuyer({ client: fakePayer(), policy: DEFAULT_POLICY(MERCHANT, "elsewhere.example") })
    expect(await offList.buy("a5", `http://${host}/api/intel/cod`, "cod")).toEqual({ ok: false, reason: `host ${host} not allowed` })
    expect(seen.settle).toBe(2)
  })

  it("refuses a bad signature and reports a failed settlement without returning data", async () => {
    const bad = await merchant(fakeFacilitator({ valid: false }).f)
    const b1 = new IntelBuyer({ client: fakePayer(), policy: DEFAULT_POLICY(MERCHANT, bad.host) })
    expect(await b1.buy("a1", `http://${bad.host}/api/intel/cod`, "cod")).toMatchObject({ ok: false, reason: expect.stringContaining("bad_signature") })
    const broke = await merchant(fakeFacilitator({ settle: false }).f)
    const b2 = new IntelBuyer({ client: fakePayer(), policy: DEFAULT_POLICY(MERCHANT, broke.host) })
    expect(await b2.buy("a1", `http://${broke.host}/api/intel/cod`, "cod")).toMatchObject({ ok: false, reason: expect.stringContaining("insufficient_balance") })
    expect(b2.spentBy("a1")).toEqual({})
  })

  it("formats Hedera tx ids for HashScan", () => {
    expect(hashscanTx("0.0.1@1700000000.000000001")).toBe("https://hashscan.io/testnet/transaction/0.0.1-1700000000-000000001")
  })
})
