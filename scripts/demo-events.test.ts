import { toKey } from "@fairtown/shared/keys"
import { toQ96 } from "@fairtown/shared/units"
import { describe as suite, expect, it } from "vitest"
import { describe, type Ctx } from "./demo-events"

const AUCTION = "0x00000000000000000000000000000000000000aa" as const
const INGRID = "0x00000000000000000000000000000000000000bb"
const ctx: Ctx = {
  name: (a) => (a.toLowerCase() === INGRID ? "Ingrid" : "someone"),
  lotOfAuction: (a) => (a.toLowerCase() === AUCTION ? 7n : undefined),
  currencyOfLot: (id) => (id === 7n ? "tEUR" : undefined),
}
const ev = (eventName: string, args: Record<string, unknown>, address: `0x${string}` = AUCTION) => describe({ eventName, args, address }, ctx)

suite("demo ticker lines", () => {
  it("prices a CCA bid from Q96 in base units of the lot's currency", () => {
    const line = ev("BidSubmitted", { id: 3n, owner: INGRID, priceQ96: toQ96(9_250_000n), amount: 120_000_000n })
    expect(line).toEqual({ tag: "UNISWAP CCA", text: "lot 7: bid 3 by Ingrid, 120 tEUR up to 9.25 tEUR/unit (Permit2)" })
  })

  it("shows the settlement split exactly, with the advance tier", () => {
    const line = ev("LotSettled", {
      lotId: 7n, finalClearingPerUnit: 8_000_000n, avgPerUnit: 8_100_000n, soldUnits: 60n,
      raised: 486_000_000n, sellerPaid: 240_570_000n, held: 240_570_000n, fee: 4_860_000n, advanceBps: 5000, pickupDeadline: 0n,
    })
    expect(line?.tag).toBe("FAIRTOWN")
    expect(line?.text).toContain("60 units sold, final 8 tEUR/unit, raised 486, seller advance 240.57 (50%), held 240.57, fee 4.86")
  })

  it("tags oracle writes as Chainlink CRE and decodes bytes32 keys", () => {
    expect(ev("DemandSignal", { id: 1n, signalKind: toKey("festival"), place: toKey("mumbai"), severity: 4, expiresAtBlock: 9n, label: "Diwali (forced)" })).toEqual({
      tag: "CHAINLINK CRE",
      text: 'W2 signal: festival in mumbai, severity 4, "Diwali (forced)"',
    })
    expect(ev("FxUpdated", { currencyCode: toKey("EUR"), perUsdE8: 86_250_000n, updatedAt: 0n })?.text).toBe("W1 FX: 1 USD = 0.8625 EUR")
  })

  it("prints listed quantity as whole units", () => {
    const line = ev("LotListed", {
      lotId: 7n, seller: INGRID, market: toKey("fish_dock"), auction: AUCTION, token: AUCTION, currency: AUCTION, sector: toKey("fish"),
      commodity: toKey("cod"), place: toKey("bergen"), qty: 120n, floorPerUnit: 7_500_000n, startBlock: 10n, endBlock: 460n, parentLotId: 0n, metadataURI: "",
    })
    expect(line?.text).toBe(`lot 7 listed by Ingrid: 120 cod at bergen, floor 7.5 tEUR/unit; CCA auction ${AUCTION} blocks 10-460`)
  })

  it("falls back to the auction address and no currency when the lot is unknown", () => {
    const line = ev("ClearingPriceUpdated", { blockNumber: 1n, clearingPriceQ96: toQ96(1_000_000n) }, "0x00000000000000000000000000000000000000cc")
    expect(line?.text).toBe("auction 0x00000000: clearing price now 1/unit")
  })

  it("drops noise events", () => {
    for (const name of ["CheckpointUpdated", "TickInitialized", "RoleGranted", "Nope"]) expect(ev(name, {})).toBeUndefined()
  })
})
