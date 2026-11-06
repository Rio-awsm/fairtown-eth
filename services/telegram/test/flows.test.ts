import type { TownEnvelope, TownEvent } from "@fairtown/shared/protocol"
import { describe, expect, it } from "vitest"
import { AgentsError, type LotInfo } from "../src/agents"
import { ACCOUNT_TEXT } from "../src/account"
import { BID_WAIT_MS, BUY_TEXT } from "../src/buy"
import { CODE_MS, HO_TEXT } from "../src/handover"
import { SELL_TEXT } from "../src/sell"
import { TRUST_TEXT } from "../src/trust"
import { ALICE, INGRID, LARS, MALLORY, OTHER_BUYER, PIN, SOLD_LOT, TX, WALKIN_1, harness } from "./harness"

type H = ReturnType<typeof harness>
type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }
const buttons = (h: H, i = -1) => ((h.calls.filter((c) => ["sendMessage", "sendPhoto"].includes(c.method)).at(i)!.payload.reply_markup as Keyboard)?.inline_keyboard ?? []).flat()
const calls = (h: H, fn: string) => h.agents.calls.filter((c) => c.fn === fn)
const BOB = { id: 2002, is_bot: false, first_name: "Bo" }

async function link(h: H, id = "ingrid", from = ALICE) {
  await h.text(`/link ${id}`, from)
  await h.text(PIN, from)
}
const join = (h: H, from = BOB, cur: "USD" | "EUR" = "EUR") => h.press(`join:${cur}`, from)
let n = 0
const env = (event: TownEvent): TownEnvelope => ({ v: 1, id: `f${++n}`, ts: 1, block: 50, source: "chain", event })
const listLot = (h: H, lotId: string) =>
  h.market.apply(
    env({ type: "lot.listed", lotId, building: "fish_dock", sector: "fish", commodity: "cod", qty: 600, unit: "kg", currency: "EUR", place: "bergen", floorPerUnit: "7500000", seller: INGRID, sellerName: "Ingrid", auction: `0x${"a".repeat(40)}`, endBlock: 100, parentLotId: "0", grade: "class_1" }),
  )

describe("buying", () => {
  it("lists open lots with bid buttons, or says there are none", async () => {
    const h = harness()
    await h.text("/market")
    expect(h.replies().at(-1)).toBe(BUY_TEXT.noLots)
    listLot(h, "13")
    await h.text("/market")
    expect(h.replies().at(-1)).toContain("#13 600 kg cod, Bergen: floor 7.5 EUR per kg, 0 bids, 50 blocks left")
    expect(buttons(h).map((b) => b.callback_data)).toEqual(["bid:13"])
  })

  it("shows one lot with its money and steps", async () => {
    const h = harness()
    listLot(h, "12")
    await h.text("/lot 12")
    const t = h.replies().at(-1)!
    expect(t).toContain("Lot #12: 600 kg cod, Bergen (Fish Dock)")
    expect(t).toContain("Clearing: 8.4 EUR per kg")
    expect(t).toContain("paid at sale 2,494.8 EUR, still held 2,494.8 EUR; pickup by block 346")
    expect(t).toContain("Steps: Listed ✓  Sold ✓  Picked up …")
    await h.text("/lot 99")
    await h.text("/lot twelve")
    expect(h.replies().slice(-2)).toEqual(["There's no lot #99.", BUY_TEXT.lotUsage])
  })

  it("bids: price and total, a confirm card, then the guardrailed route", async () => {
    const h = harness()
    listLot(h, "13")
    await join(h)
    await h.text("/bid 13", BOB)
    expect(h.replies().at(-1)).toMatch(/^Send your highest price per kg in EUR/)
    await h.text("8,40 600", BOB)
    expect(h.replies().at(-1)).toBe("Bid on lot #13: up to 8.4 EUR per kg, spending at most 600 EUR.\nThe market's guardrails check it before anything reaches the chain, and lower the amount if it's more than your budget or 60% of the auction allows. Test money only.")
    await h.press("bid:ok:13", BOB)
    expect(calls(h, "bid")[0]!.args[0]).toEqual({ token: "walkin-session-1", lotId: "13", maxPerUnit: "8400000", amount: "600000000" })
    expect(h.replies().at(-1)).toBe(`Bid #7 placed on lot #13 (the guardrails may have lowered the amount to fit). I'll tell you if you're outbid.\nTransaction: ${TX}`)
    expect(h.market.bidsOn("13")).toEqual([{ user: BOB.id, maxPerUnit: 8_400_000n, outbidSent: false }])
    await h.press("bid:ok:13", BOB)
    expect(calls(h, "bid")).toHaveLength(1)
  })

  it("starts a bid from the market button", async () => {
    const h = harness()
    await join(h)
    await h.press("bid:13", BOB)
    expect(h.replies().at(-1)).toMatch(/^Send your highest price/)
  })

  it("refuses bids from sellers, non-members, closed lots and the wrong currency", async () => {
    const h = harness()
    await h.text("/bid 13", BOB)
    expect(h.replies().at(-1)).toBe(BUY_TEXT.joinFirst)
    await link(h)
    await h.text("/bid 13")
    expect(h.replies().at(-1)).toBe(BUY_TEXT.sellersCant)
    await join(h)
    await h.text("/bid 12", BOB)
    expect(h.replies().at(-1)).toBe(BUY_TEXT.notOpen("12", "sold"))
    await join(h, MALLORY, "USD")
    await h.text("/bid 13", MALLORY)
    expect(h.replies().at(-1)).toBe(BUY_TEXT.wrongCurrency("13", "EUR", "USD"))
    await h.text("/bid 99", BOB)
    expect(h.replies().at(-1)).toBe("There's no lot #99.")
  })

  it("checks the numbers before showing a card", async () => {
    const h = harness()
    await join(h)
    await h.text("/bid 13", BOB)
    for (const t of ["8.40", "8.4 six hundred", "8.40 600 7", "8.1234567 600"]) {
      await h.text(t, BOB)
      expect(h.replies().at(-1)).toBe(BUY_TEXT.badBid)
    }
    await h.text("0 600", BOB)
    expect(h.replies().at(-1)).toBe(BUY_TEXT.zero)
    expect(calls(h, "bid")).toEqual([])
  })

  it("explains guardrail refusals, failures and silence, and never retries blind", async () => {
    const cases: Array<[AgentsError, string]> = [
      [new AgentsError(409, "bid_rejected", "over 60% of the auction"), BUY_TEXT.rejected("over 60% of the auction")],
      [new AgentsError(502, "bid_failed", "x"), BUY_TEXT.failed],
      [new AgentsError(0, "timeout", "x"), BUY_TEXT.unsure("13")],
    ]
    for (const [err, want] of cases) {
      const h = harness()
      await join(h)
      await h.text("/bid 13", BOB)
      await h.text("8.4 600", BOB)
      h.agents.fail.bid = err
      await h.press("bid:ok:13", BOB)
      expect(h.replies().at(-1)).toBe(want)
      await h.press("bid:ok:13", BOB)
      expect(calls(h, "bid")).toHaveLength(1)
      expect(h.market.bidsOn("13")).toEqual([])
    }
  })

  it("lets a bid card lapse after 5 minutes, and cancels cleanly", async () => {
    const h = harness()
    await join(h)
    await h.text("/bid 13", BOB)
    await h.text("8.4 600", BOB)
    h.tick(BID_WAIT_MS + 1)
    await h.press("bid:ok:13", BOB)
    expect(calls(h, "bid")).toEqual([])
    await h.text("/bid 13", BOB)
    await h.text("8.4 600", BOB)
    await h.press("bid:no:13", BOB)
    expect(h.replies().at(-1)).toBe(BUY_TEXT.cancelled)
  })
})

describe("handover", () => {
  it("issues a QR, a code and the scan link to the seller, then the buyer confirms with the code", async () => {
    const h = harness()
    await link(h)
    await h.text("/qr 12")
    expect(calls(h, "ticket")[0]!.args).toEqual([`seller-session-ingrid-${ALICE.id}`, { sellerId: "ingrid", lotId: "12", buyer: WALKIN_1, tokenAmount: "600000000000000000000" }])
    const photo = h.calls.find((c) => c.method === "sendPhoto")!
    expect(String(photo.payload.caption)).toContain("Code: 482 191 (they send /receive 482191 to this bot)")
    expect(String(photo.payload.caption)).toContain("https://town.example/scan#t=abc")
    expect(h.qrs).toEqual(["FT1.ticket-text"])
    await join(h)
    await h.text("/receive 482 191", BOB)
    expect(calls(h, "confirmHandover")[0]!.args[0]).toMatchObject({ receiverId: WALKIN_1, ticket: { lotId: "12", buyer: WALKIN_1 } })
    expect(h.replies().at(-1)).toBe("Handover confirmed for lot #12. 2,494.8 EUR released to the seller.")
    await h.text("/receive 482191", BOB)
    expect(h.replies().at(-1)).toBe(HO_TEXT.badCode) // spent
  })

  it("still gives the code and link when the QR can't be drawn", async () => {
    const h = harness({ qr: async () => Promise.reject(new Error("no qrcode package")) })
    await link(h)
    await h.text("/qr 12")
    expect(h.replies().at(-1)).toContain("Code: 482 191")
    expect(h.replies().at(-1)).toContain(HO_TEXT.noImage)
  })

  it("lets only the lot's seller show a code, and only for goods someone holds", async () => {
    const h = harness()
    await h.text("/qr 12")
    expect(h.replies().at(-1)).toBe(HO_TEXT.sellersOnly)
    await link(h, "lars")
    await h.text("/qr 12")
    expect(h.replies().at(-1)).toBe(HO_TEXT.notYours("12"))
    const s = harness()
    await link(s)
    await s.text("/qr 13")
    expect(s.replies().at(-1)).toBe(HO_TEXT.nobody("13"))
    expect(calls(s, "ticket")).toEqual([])
  })

  it("asks which buyer when several hold the lot", async () => {
    const h = harness()
    h.agents.lots.set("12", { ...SOLD_LOT, winners: [{ buyer: WALKIN_1, tokenAmount: "400000000000000000000" }, { buyer: OTHER_BUYER, tokenAmount: "200000000000000000000" }] } as LotInfo)
    await link(h)
    await h.text("/qr 12")
    expect(buttons(h).map((b) => b.text)).toEqual([`${WALKIN_1.slice(0, 6)}…${WALKIN_1.slice(-4)}: 400 units`, "0x0000…00d4: 200 units"])
    await h.press(`qr:12:${OTHER_BUYER}`)
    expect(calls(h, "ticket")[0]!.args[1]).toMatchObject({ buyer: OTHER_BUYER, tokenAmount: "200000000000000000000" })
  })

  it("limits code guesses, lets codes run out, and takes drivers as receivers", async () => {
    const h = harness()
    await join(h)
    for (let i = 0; i < 5; i++) await h.text(`/receive 00000${i}`, BOB)
    await h.text("/receive 000009", BOB)
    expect(h.replies().at(-1)).toBe(HO_TEXT.tooMany)
    const s = harness()
    await link(s)
    await s.text("/qr 12")
    await link(s, "lars", MALLORY)
    s.tick(CODE_MS + 1)
    await s.text("/receive 482191", MALLORY)
    expect(s.replies().at(-1)).toBe(HO_TEXT.badCode)
    await s.text("/qr 12")
    await s.text("/receive 482192", MALLORY)
    expect(calls(s, "confirmHandover")[0]!.args[0]).toMatchObject({ receiverId: LARS })
    await s.text("/receive 482192")
    expect(s.replies().at(-1)).toBe(HO_TEXT.receiversOnly) // a seller doesn't receive
  })

  it("explains an expired ticket, a refusal and silence", async () => {
    for (const [err, want] of [
      [new AgentsError(409, "TicketExpired", "x"), HO_TEXT.expired],
      [new AgentsError(409, "NotReceiver", "x"), HO_TEXT.refused("NotReceiver")],
      [new AgentsError(0, "timeout", "x"), HO_TEXT.unsure("12")],
    ] as const) {
      const h = harness()
      await link(h)
      await h.text("/qr 12")
      await join(h)
      h.agents.fail.confirmHandover = err
      await h.text("/receive 482191", BOB)
      expect(h.replies().at(-1)).toBe(want)
    }
  })
})

describe("trust paths", () => {
  it("reports a no-show only after a button press, for goods the buyer holds", async () => {
    const h = harness()
    await join(h)
    await h.text("/noshow 13", BOB)
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.notHolder("13"))
    await h.text("/noshow 12", BOB)
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.confirmReport("12"))
    expect(calls(h, "reportNoShow")).toEqual([])
    await h.press("ns:ok:12", BOB)
    expect(calls(h, "reportNoShow")[0]!.args[0]).toEqual({ buyerId: WALKIN_1, lotId: "12", tokenAmount: "600000000000000000000" })
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.reported("12", 900))
    await h.press("ns:ok:12", BOB)
    expect(calls(h, "reportNoShow")).toHaveLength(1)
    await link(h)
    await h.text("/noshow 12")
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.buyersOnly)
  })

  it("files a quality dispute with photos", async () => {
    const h = harness()
    await join(h)
    await h.text("/dispute 12", BOB)
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.askEvidence("dispute", "4821"))
    await h.press("ev:send", BOB)
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.needPhoto)
    await h.photo({ id: "d1", from: BOB })
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.saved(1))
    await h.press("ev:send", BOB)
    const body = calls(h, "dispute")[0]!.args[0] as { photos: Array<{ lotCode: string }> }
    expect(body).toMatchObject({ buyerId: WALKIN_1, lotId: "12", tokenAmount: "600000000000000000000" })
    expect(body.photos.map((p) => p.lotCode)).toEqual(["4821"])
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.filed("dispute", "12", "4"))
  })

  it("contests a no-show with photos, once the report is seen", async () => {
    const h = harness()
    await link(h)
    listLot(h, "12")
    await h.text("/contest 12")
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.noReport("12"))
    h.market.apply(env({ type: "noshow.reported", lotId: "12", buyer: WALKIN_1, contestEnds: 900 }))
    await h.text("/contest 12")
    await h.photo({ id: "c1" })
    await h.press("ev:send")
    expect(calls(h, "contestNoShow")[0]!.args[0]).toBe(`seller-session-ingrid-${ALICE.id}`)
    expect(calls(h, "contestNoShow")[0]!.args[1]).toMatchObject({ sellerId: "ingrid", lotId: "12", buyer: WALKIN_1.toLowerCase() })
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.filed("contest", "12", "3"))
    const other = harness()
    await link(other, "lars")
    listLot(other, "12")
    other.market.apply(env({ type: "noshow.reported", lotId: "12", buyer: WALKIN_1, contestEnds: 900 }))
    await other.text("/contest 12")
    expect(other.replies().at(-1)).toBe(TRUST_TEXT.notYours("12"))
  })

  it("routes photos to the flow that asked for them, not to a listing", async () => {
    const h = harness()
    await link(h)
    listLot(h, "12")
    h.market.apply(env({ type: "noshow.reported", lotId: "12", buyer: WALKIN_1, contestEnds: 900 }))
    await h.text("/sell")
    await h.text("/contest 12")
    await h.photo({ id: "c1" })
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.saved(1))
    await h.text("600 kg cod")
    expect(calls(h, "draft")).toEqual([]) // the listing was ended when the contest began
    await h.text("/cancel")
    await h.press("ev:send")
    expect(calls(h, "contestNoShow")).toEqual([])
  })

  it("closes an evidence upload that got no answer, and says it can't tell", async () => {
    const h = harness()
    await join(h)
    await h.text("/dispute 12", BOB)
    await h.photo({ id: "d1", from: BOB })
    h.agents.fail.dispute = new AgentsError(0, "timeout", "x")
    await h.press("ev:send", BOB)
    expect(h.replies().at(-1)).toBe(TRUST_TEXT.unsure("12"))
    await h.press("ev:send", BOB)
    expect(calls(h, "dispute")).toHaveLength(1)
  })
})

describe("account", () => {
  it("lists a seller's lots from the town and a buyer's bids", async () => {
    const h = harness()
    await h.text("/lots")
    expect(h.replies().at(-1)).toBe(ACCOUNT_TEXT.signIn)
    await link(h)
    await h.text("/lots")
    expect(h.replies().at(-1)).toBe(ACCOUNT_TEXT.noLots)
    listLot(h, "12")
    listLot(h, "14")
    await h.text("/lots")
    expect(h.replies().at(-1)).toMatch(/^Your lots:\n#14 .*\n#12 /)
    await join(h)
    await h.text("/lots", BOB)
    expect(h.replies().at(-1)).toBe(ACCOUNT_TEXT.noBids)
    h.market.recordBid("12", BOB.id, 8_000_000n)
    await h.text("/lots", BOB)
    expect(h.replies().at(-1)).toMatch(/^Lots you bid on:\n#12 600 kg cod/)
  })

  it("adds up payouts exactly and shows a buyer's budget", async () => {
    const h = harness()
    h.agents.payouts = [
      { lotId: "12", kind: "advance", amount: "2494800000", currency: "EUR" },
      { lotId: "14", kind: "advance", amount: "1000000", currency: "EUR" },
      { lotId: "12", kind: "release", amount: "2494800000", currency: "EUR" },
    ]
    await link(h)
    await h.text("/profile")
    expect(h.replies().at(-1)).toBe("Ingrid Solheim (seller, id ingrid)\nTier: new. Record: 2 clean lots, 0 no-shows\nPayouts:\n  advance: 2,495.8 EUR\n  release: 2,494.8 EUR")
    await join(h)
    await h.text("/profile", BOB)
    expect(h.replies().at(-1)).toBe("Bo, buyer (test money in EUR)\nBudget: 500 EUR\nVisit ends in 119 minutes.")
  })

  it("gives sellers price advice", async () => {
    const h = harness()
    await h.text("/advice")
    expect(h.replies().at(-1)).toBe(ACCOUNT_TEXT.advice)
    await link(h)
    await h.text("/advice")
    expect(h.replies().at(-1)).toMatch(/^Cod in Bergen cleared/)
  })

  it("lists every command in /help", async () => {
    const h = harness()
    await h.text("/help")
    for (const c of ["market", "bid", "sell", "qr", "receive", "noshow", "dispute", "contest", "lots", "profile", "advice"]) expect(h.replies().at(-1)).toContain(`/${c}`)
    expect(SELL_TEXT.instructions).toContain("caption")
  })
})
