import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http"
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server"
import type { PaymentRequirements, Price } from "@x402/core/types"
import { ExactHederaScheme } from "@x402/hedera/exact/server"
import { ARKIV_SCHEMAS } from "@fairtown/shared/arkiv"
import type { FastifyInstance } from "fastify"
import type { ArkivStore } from "../../arkiv/ArkivStore"
import { SECTOR_OF } from "../../listing/catalog"
import { HttpError } from "../../listing/routes"
import type { MarketState } from "../../market/state"

export const HEDERA_TESTNET_USDC = "0.0.429274" // @x402/hedera source constant (the README example's 0.0.6001 is stale)
export const NETWORK = "hedera:testnet"
// Two ways to pay: 0.01 USDC (6 decimals) or 0.05 HBAR (tinybars). The agent picks what it holds.
export const INTEL_PRICES: Price[] = [
  { asset: HEDERA_TESTNET_USDC, amount: "10000" },
  { asset: "0.0.0", amount: "5000000" },
]

export type Intel = {
  commodity: string
  generatedAt: string
  recentClears: Array<{ lotId: string; place: string; currency: string; perUnit: string; soldUnits: string; day: string }>
  medianClear: string | null
  signals: Array<{ kind: string; place: string; severity: number; label: string }>
  sellersWithNoShows: Array<{ seller: string; noShows: number; cleanLots: number }>
}

// What the paid call returns: recent clears for the commodity, live signals for its sector, sellers with a no-show record.
export async function buildIntel(commodity: string, d: { arkiv: Pick<ArkivStore, "query">; market?: MarketState; block?: () => Promise<bigint> }): Promise<Intel> {
  const prices = await d.arkiv.query(ARKIV_SCHEMAS.price, { commodity }, { limit: 20, orderBy: { field: "lotId", dir: "desc" } }).catch(() => ({ entities: [] }))
  const clears = prices.entities.map((e) => ({
    lotId: String(e.values.lotId),
    place: String(e.values.place),
    currency: String(e.values.currency),
    perUnit: String(e.values.finalClearingPerUnit),
    soldUnits: String(e.values.soldUnits),
    day: String(e.values.day),
  }))
  const sorted = clears.map((c) => BigInt(c.perUnit)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]!.toString() : null
  const rep = await d.arkiv.query(ARKIV_SCHEMAS.reputation, { noShows: { gte: 1n } }, { limit: 50 }).catch(() => ({ entities: [] }))
  const bySeller = new Map<string, { seller: string; noShows: number; cleanLots: number }>()
  for (const e of rep.entities) {
    const s = String(e.values.seller)
    const v = { seller: s, noShows: Number(e.values.noShows), cleanLots: Number(e.values.cleanLots) }
    if (!bySeller.has(s) || bySeller.get(s)!.noShows < v.noShows) bySeller.set(s, v)
  }
  const sector = SECTOR_OF[commodity as keyof typeof SECTOR_OF]
  const block = (await d.block?.()) ?? 0n
  const signals = d.market && sector ? d.market.active(block).filter((s) => d.market!.signalsFor(s.place, sector, block).length) : []
  return {
    commodity,
    generatedAt: new Date().toISOString(),
    recentClears: clears,
    medianClear: median,
    signals: signals.map((s) => ({ kind: s.kind, place: s.place, severity: s.severity, label: s.label })),
    sellersWithNoShows: [...bySeller.values()],
  }
}

export function intelServer(facilitatorUrl: string, facilitator?: FacilitatorClient) {
  return new x402ResourceServer(facilitator ?? new HTTPFacilitatorClient({ url: facilitatorUrl })).register(NETWORK, new ExactHederaScheme())
}

// GET /api/intel/:commodity, x402-protected (Hedera testnet). Settles only after the data is ready.
export function registerIntelRoute(app: FastifyInstance, d: { server: x402ResourceServer; payTo: string; arkiv: Pick<ArkivStore, "query">; market?: MarketState; block?: () => Promise<bigint>; onSettled?: (tx: string, req: PaymentRequirements) => void }) {
  let requirements: Promise<PaymentRequirements[]> | undefined
  const reqs = () =>
    (requirements ??= d.server.initialize().then(async () => (await Promise.all(INTEL_PRICES.map((price) => d.server.buildPaymentRequirements({ scheme: "exact", network: NETWORK, payTo: d.payTo, price, maxTimeoutSeconds: 120 })))).flat()))

  app.get<{ Params: { commodity: string } }>("/api/intel/:commodity", async (req, reply) => {
    const commodity = req.params.commodity.toLowerCase()
    if (!(commodity in SECTOR_OF)) throw new HttpError(404, "unknown_commodity", `No intel for ${commodity}`)
    const all = await reqs()
    const header = (req.headers["payment-signature"] ?? req.headers["x-payment"]) as string | undefined
    const resource = { url: `${req.protocol}://${req.host}${req.url}`, description: `Fairtown market intel for ${commodity}: recent clears, signals, seller no-shows`, mimeType: "application/json" }
    if (!header) {
      const pr = await d.server.createPaymentRequiredResponse(all, resource)
      return reply.status(402).header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(pr)).send(pr)
    }
    let payload
    try {
      payload = decodePaymentSignatureHeader(header)
    } catch {
      throw new HttpError(400, "bad_payment", "Unreadable payment header")
    }
    const match = d.server.findMatchingRequirements(all, payload)
    if (!match) return reply.status(402).send({ error: "payment does not match any accepted price" })
    const v = await d.server.verifyPayment(payload, match)
    if (!v.isValid) return reply.status(402).send({ error: v.invalidReason ?? "invalid payment", message: v.invalidMessage })
    const intel = await buildIntel(commodity, d)
    const s = await d.server.settlePayment(payload, match)
    if (!s.success) return reply.status(402).send({ error: s.errorReason ?? "settlement failed", message: s.errorMessage })
    d.onSettled?.(s.transaction, match)
    return reply.header("PAYMENT-RESPONSE", encodePaymentResponseHeader(s)).send({ ...intel, payment: { transaction: s.transaction, network: s.network, asset: match.asset, amount: match.amount, hashscan: hashscanTx(s.transaction) } })
  })
}

// "0.0.123@1700000000.000000001" -> HashScan path form "0.0.123-1700000000-000000001".
export const hashscanTx = (tx: string) => `https://hashscan.io/testnet/transaction/${tx.includes("@") ? tx.replace("@", "-").replace(/\.(\d+)$/, "-$1") : tx}`
