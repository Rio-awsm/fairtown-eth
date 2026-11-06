import { AdviceResponse, FxResponse } from "@fairtown/shared/api"
import type { FastifyInstance } from "fastify"
import { HttpError, jsonSafe } from "../listing/routes"
import type { SellerDirectory } from "../sellers"
import { sellerAdvice, type AdviceDeps } from "./advice"
import type { MarketState } from "./state"

export type MarketDeps = AdviceDeps & { market: MarketState; sellers: SellerDirectory }

export function registerMarketRoutes(app: FastifyInstance, d: MarketDeps) {
  app.get<{ Params: { sellerId: string }; Querystring: { commodity?: string } }>("/api/sellers/:sellerId/advice", async (req) => {
    const seller = d.sellers.get(req.params.sellerId)
    if (!seller) throw new HttpError(404, "unknown_seller", `No seller ${req.params.sellerId}`)
    return AdviceResponse.parse(jsonSafe(await sellerAdvice(d, seller, req.query.commodity)))
  })
  app.get("/api/fx", async () => FxResponse.parse(d.market.fxView()))
}
