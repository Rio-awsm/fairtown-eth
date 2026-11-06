import { describe, expect, it } from "vitest"
import { AgentsError, type DraftBody } from "../src/agents"
import { TEXT } from "../src/bot"
import { FileError } from "../src/files"
import { ID_TEXT } from "../src/identity"
import { SELL_TEXT, SELL_WAIT_MS, draftCard, payoutAtFloor } from "../src/sell"
import { ALICE, COD_DRAFT, MALLORY, PIN, TX, harness } from "./harness"

type H = ReturnType<typeof harness>
type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
const keyboard = (h: H, i = -1) => (h.sent().at(i)!.payload.reply_markup as Keyboard).inline_keyboard.flat()
const ID = COD_DRAFT.draftId

async function seller(h: H, id = "ingrid") {
  await h.text(`/link ${id}`)
  await h.text(PIN)
}
async function toCard(h: H) {
  await seller(h)
  await h.photo({ id: "a", caption: "600 kg cod, landed 04:40, Bergen" })
}
const drafts = (h: H) => h.agents.calls.filter((c) => c.fn === "draft")
const confirms = (h: H) => h.agents.calls.filter((c) => c.fn === "confirm")

describe("who can sell", () => {
  it("needs a seller sign-in, not a buyer one, and a live session", async () => {
    const h = harness()
    await h.text("/sell")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.signInFirst)
    await h.press("join:USD")
    await h.text("/sell")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.buyersCant)
    const s = harness()
    await seller(s)
    s.tick(121 * 60_000)
    await s.text("/sell")
    expect(s.replies().at(-1)).toMatch(/session ended. Send \/link ingrid/)
  })

  it("lets a driver list truck capacity the same way", async () => {
    const h = harness()
    await seller(h, "lars")
    await h.photo({ id: "a", caption: "One reefer, Bergen to Oslo, 12 pallets" })
    expect(drafts(h)[0]!.args[1]).toMatchObject({ sellerId: "lars", text: "One reefer, Bergen to Oslo, 12 pallets" })
  })

  it("tells a seller how to sell when they sign in", async () => {
    const h = harness()
    await seller(h)
    expect(h.replies().at(-1)).toContain("send a photo of your lot with a description as the caption")
    await h.press("join:USD", MALLORY)
    expect(h.replies().at(-1)).not.toContain("caption")
  })

  it("leaves photos from buyers and strangers alone", async () => {
    const h = harness()
    await h.photo({ id: "a", caption: "600 kg cod" })
    await h.press("join:USD", MALLORY)
    await h.photo({ id: "b", caption: "600 kg cod", from: MALLORY })
    expect(drafts(h)).toEqual([])
    expect(h.files.fetched).toEqual([])
  })

  it("doesn't start a listing from a photo when the seller's session ended", async () => {
    const h = harness()
    await seller(h)
    h.tick(121 * 60_000)
    await h.photo({ id: "a", caption: "600 kg cod" })
    expect(drafts(h)).toEqual([])
  })
})

describe("listing a lot", () => {
  it("goes from one captioned photo to a listed lot, with no /sell and no lot code", async () => {
    const h = harness()
    await seller(h)
    await h.photo({ id: "a", caption: "600 kg cod, landed 04:40, Bergen" })
    expect(h.files.fetched).toEqual(["a-l"]) // the largest size
    const [call] = drafts(h)
    expect(call!.args[0]).toBe(`seller-session-ingrid-${ALICE.id}`)
    expect(call!.args[1]).toEqual({
      sellerId: "ingrid",
      text: "600 kg cod, landed 04:40, Bergen",
      photos: [{ dataUrl: `data:image/jpeg;base64,${Buffer.from("jpeg-bytes-of-a-l").toString("base64")}`, lotCode: "4821", capturedAt: new Date(h.DATE * 1000).toISOString() }],
    } satisfies DraftBody)
    const card = h.replies().at(-1)!
    expect(card).toContain("600 kg cod, Bergen (Fish Dock)")
    expect(card).toContain("Grade: class 1, 80% sure")
    expect(card).toContain("Floor: 7.5 EUR per kg (suggested)")
    expect(card).toContain("Why: Reference 8.10 EUR/kg; Grade class 1")
    expect(card).toContain("at least 2,227.5 EUR at the sale and 2,227.5 EUR at handover (new seller, 50% at the sale)")
    expect(keyboard(h).map((b) => b.callback_data)).toEqual([`sell:ok:${ID}`, `sell:floor:${ID}`, `sell:no:${ID}`])
    expect(keyboard(h)[0]!.text).toBe("List at 7.5")
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)[0]!.args[0]).toEqual({ draftId: ID, floorPerUnit: "7500000", durationBlocks: 150 })
    expect(h.calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true)
    expect(h.replies().at(-1)).toBe(SELL_TEXT.listed(COD_DRAFT, 7_500_000n, "12", 150, TX))
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)).toHaveLength(1) // that card is spent
  })

  it("takes a photo first and the description as the next message", async () => {
    const h = harness()
    await seller(h)
    await h.photo({ id: "a" })
    expect(h.replies().at(-1)).toBe(SELL_TEXT.photoSaved)
    expect(drafts(h)).toEqual([])
    await h.text("600 kg cod, Bergen")
    expect(drafts(h)[0]!.args[1]).toMatchObject({ text: "600 kg cod, Bergen", photos: [expect.objectContaining({ lotCode: "4821" })] })
  })

  it("lists with no photos at all through /sell", async () => {
    const h = harness()
    await seller(h)
    await h.text("/sell")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.instructions)
    await h.text("600 kg cod, Bergen")
    expect((drafts(h)[0]!.args[1] as DraftBody).photos).toEqual([])
  })

  it("drafts once from a whole album, after its photos stop arriving", async () => {
    const h = harness()
    await seller(h)
    const before = h.replies().length
    await h.photo({ id: "a", group: "g1", caption: "600 kg cod, Bergen" })
    await h.photo({ id: "b", group: "g1" })
    await h.photo({ id: "c", group: "g1" })
    expect(drafts(h)).toEqual([])
    expect(h.replies().slice(before)).toEqual([]) // nothing until the album is complete
    await h.flush()
    expect(drafts(h)).toHaveLength(1)
    expect((drafts(h)[0]!.args[1] as DraftBody).photos).toHaveLength(3)
    expect(h.replies().slice(before)).toHaveLength(1) // just the card
    expect(keyboard(h)[0]!.callback_data).toBe(`sell:ok:${ID}`)
  })

  it("asks once for a description after an album without a caption", async () => {
    const h = harness()
    await seller(h)
    const before = h.replies().length
    await h.photo({ id: "a", group: "g2" })
    await h.photo({ id: "b", group: "g2" })
    await h.flush()
    expect(h.replies().slice(before)).toEqual([SELL_TEXT.photoSaved])
    await h.text("600 kg cod, Bergen")
    expect((drafts(h)[0]!.args[1] as DraftBody).photos).toHaveLength(2)
  })

  it("drops an album timer once the listing has moved on", async () => {
    const h = harness()
    await seller(h)
    await h.photo({ id: "a", group: "g3", caption: "600 kg cod, Bergen" })
    await h.text("/cancel")
    await h.flush()
    expect(drafts(h)).toEqual([])
  })

  it("logs instead of crashing when an album draft fails", async () => {
    const h = harness()
    await seller(h)
    await h.photo({ id: "a", group: "g4", caption: "600 kg cod, Bergen" })
    h.agents.fail.draft = new Error("boom")
    await h.flush()
    expect(h.logs.some((l) => l.level === "error")).toBe(true)
  })

  it("starts a fresh listing when a new captioned photo comes while a card is open", async () => {
    const h = harness()
    await toCard(h)
    await h.photo({ id: "b", caption: "200 kg haddock, Bergen" })
    expect(h.replies()).toContain(SELL_TEXT.restart)
    expect(drafts(h)).toHaveLength(2)
    expect((drafts(h)[1]!.args[1] as DraftBody).text).toBe("200 kg haddock, Bergen")
  })

  it("keeps photos sent as evidence for a dispute or contest out of listings", async () => {
    const h = harness()
    await seller(h)
    h.market.apply({ id: "e1", ts: 1, event: { type: "noshow.reported", lotId: "12", buyer: "0x" + "c".repeat(40), contestEnds: 900 } } as never)
    await h.text("/contest 12")
    await h.photo({ id: "a", caption: "handed over at 05:10" })
    expect(drafts(h)).toEqual([])
  })

  it("doesn't show the lot-code check, since sellers aren't asked for one", async () => {
    const h = harness()
    h.agents.draftResult = { ...COD_DRAFT, gradeReport: { ...COD_DRAFT.gradeReport, defects: ["Lot code not visible", "Ice melting"] } }
    await toCard(h)
    expect(h.replies().at(-1)).toContain("Checks: Ice melting")
    expect(h.replies().at(-1)).not.toContain("Lot code")
  })

  it("keeps at most three photos", async () => {
    const h = harness()
    await seller(h)
    for (const id of ["a", "b", "c", "d"]) await h.photo({ id })
    expect(h.replies().at(-1)).toBe(SELL_TEXT.tooMany)
    await h.text("600 kg cod, Bergen")
    expect((drafts(h)[0]!.args[1] as DraftBody).photos).toHaveLength(3)
  })

  it("says when a photo can't be fetched or is too big, and keeps going", async () => {
    const h = harness()
    await seller(h)
    await h.text("/sell")
    h.files.fail = new FileError("download_failed")
    await h.photo({ id: "a" })
    expect(h.replies().at(-1)).toBe(SELL_TEXT.photoFailed)
    h.files.fail = new FileError("too_big")
    await h.photo({ id: "b" })
    expect(h.replies().at(-1)).toBe(SELL_TEXT.photoTooBig)
    delete h.files.fail
    await h.text("600 kg cod, Bergen")
    expect((drafts(h)[0]!.args[1] as DraftBody).photos).toEqual([])
  })

  it("asks for text instead of a voice note", async () => {
    const h = harness()
    await seller(h)
    await h.text("/sell")
    await h.voice()
    expect(h.replies().at(-1)).toBe(SELL_TEXT.noVoice)
    expect(drafts(h)).toEqual([])
  })

  it("rejects a description that is too long", async () => {
    const h = harness()
    await seller(h)
    await h.text("/sell")
    await h.text("cod ".repeat(200))
    expect(h.replies().at(-1)).toBe(SELL_TEXT.tooLong)
    expect(drafts(h)).toEqual([])
  })
})

describe("the draft card", () => {
  it("changes the floor, exactly, from 7.20 or 7,20", async () => {
    const h = harness()
    await toCard(h)
    await h.press(`sell:floor:${ID}`)
    expect(h.replies().at(-1)).toBe(SELL_TEXT.askFloor(COD_DRAFT, 7_500_000n))
    await h.text("cheap")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.badFloor(COD_DRAFT))
    await h.text("0.0000001")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.badFloor(COD_DRAFT)) // more than 6 decimals
    await h.text("0.0001")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.floorTooLow)
    await h.text("0.000999")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.floorTooLow)
    await h.text("7,20")
    const card = h.replies().at(-1)!
    expect(card).toContain("Floor: 7.2 EUR per kg (your price)")
    expect(card).toContain("at least 2,138.4 EUR at the sale and 2,138.4 EUR at handover")
    expect(card).not.toContain("Why:")
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)[0]!.args[0]).toMatchObject({ floorPerUnit: "7200000" })
  })

  it("cancels without listing", async () => {
    const h = harness()
    await toCard(h)
    await h.press(`sell:no:${ID}`)
    expect(h.replies().at(-1)).toBe(SELL_TEXT.cancelled)
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)).toEqual([])
  })

  it("points plain messages back to the buttons while a card is open", async () => {
    const h = harness()
    await toCard(h)
    await h.text("ok")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.useButtons)
  })

  it("ignores a button for another draft", async () => {
    const h = harness()
    await toCard(h)
    await h.press("sell:ok:d_00000000ffff")
    expect(h.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: TEXT.expired } })
    expect(confirms(h)).toEqual([])
  })

  it("lists once when List is tapped twice at once", async () => {
    const h = harness()
    await toCard(h)
    let open!: () => void
    h.agents.confirmGate = new Promise((r) => (open = r))
    const a = h.press(`sell:ok:${ID}`)
    await new Promise((r) => setTimeout(r, 0))
    const b = h.press(`sell:ok:${ID}`)
    await new Promise((r) => setTimeout(r, 0))
    open()
    await Promise.all([a, b])
    expect(confirms(h)).toHaveLength(1)
    expect(h.replies()).toContain(ID_TEXT.busy)
  })

  it("lapses after 15 quiet minutes: no listing, stale buttons, messages fall through", async () => {
    const h = harness()
    await toCard(h)
    h.tick(SELL_WAIT_MS + 1)
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)).toEqual([])
    expect(h.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: TEXT.expired } })
    await h.text("hello")
    expect(h.replies().at(-1)).toBe(TEXT.unknown)
  })

  it("is cleared by /cancel and /logout", async () => {
    const h = harness()
    await toCard(h)
    await h.text("/cancel")
    expect(h.replies().at(-1)).toBe(ID_TEXT.cancelled)
    await h.text("/sell")
    await h.text("/logout")
    await h.text("600 kg cod")
    expect(drafts(h)).toHaveLength(1)
    expect(h.replies().at(-1)).toBe(TEXT.unknown)
  })

  it("keeps each user's listing to themselves", async () => {
    const h = harness()
    await toCard(h)
    await h.press(`sell:ok:${ID}`, MALLORY)
    await h.text("7.20", MALLORY)
    expect(confirms(h)).toEqual([])
  })

  it("never offers List at the 0.001 placeholder when there is no real suggestion", async () => {
    const h = harness()
    h.agents.draftResult = { ...COD_DRAFT, suggestedFloorPerUnit: "1000", floorBasis: ["No reference or recent clears; set your own floor"] }
    await toCard(h)
    expect(h.replies().at(-1)).toContain("Floor: not set")
    expect(h.replies().at(-1)).not.toContain("at least")
    expect(keyboard(h).map((b) => b.callback_data)).toEqual([`sell:floor:${ID}`, `sell:no:${ID}`])
    await h.press(`sell:ok:${ID}`) // forged or old button
    expect(confirms(h)).toEqual([])
    expect(h.replies().at(-1)).toContain("Floor: not set")
    await h.press(`sell:floor:${ID}`)
    expect(h.replies().at(-1)).toContain("for example 7.20")
    await h.text("6")
    expect(keyboard(h)[0]!.text).toBe("List at 6")
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)[0]!.args[0]).toMatchObject({ floorPerUnit: "6000000" })
  })

  it("renders money with bigint math only", () => {
    const big = { ...COD_DRAFT, qty: "9000000" }
    expect(payoutAtFloor(big, 999_999_999_999n)).toEqual({ fee: 89_999_999_999_910_000n, advance: 4_454_999_999_995_545_000n, held: 4_454_999_999_995_545_000n })
    expect(draftCard(big, 999_999_999_999n, "Ingrid")).toContain("at least 4,454,999,999,995.545 EUR at the sale")
  })
})

describe("when the agents service says no", () => {
  it("keeps the photos when the description can't be read", async () => {
    const h = harness()
    await seller(h)
    await h.text("/sell")
    await h.photo({ id: "a" })
    h.agents.fail.draft = new AgentsError(422, "unreadable", "Couldn't read that. Try something like: 600 kg cod, Bergen")
    await h.text("fish")
    expect(h.replies().at(-1)).toBe(SELL_TEXT.unreadable("Couldn't read that. Try something like: 600 kg cod, Bergen"))
    delete h.agents.fail.draft
    await h.text("600 kg cod, Bergen")
    expect((drafts(h)[1]!.args[1] as DraftBody).photos).toHaveLength(1)
  })

  it("asks to sign in again when the agents service no longer knows the session", async () => {
    const h = harness()
    await seller(h)
    await h.text("/sell")
    h.agents.fail.draft = new AgentsError(401, "no_session", "Sign in as the seller first")
    await h.text("600 kg cod, Bergen")
    expect(h.replies().at(-1)).toMatch(/session ended. Send \/link ingrid/)
    expect(h.links.session(ALICE.id)).toBeUndefined()
  })

  it("says already listed and closes the draft", async () => {
    const h = harness()
    await toCard(h)
    h.agents.fail.confirm = new AgentsError(409, "already_listed", "Draft d_0000000000c1 is already lot 12")
    await h.press(`sell:ok:${ID}`)
    expect(h.replies().at(-1)).toBe("Draft d_0000000000c1 is already lot 12")
    await h.text("ok")
    expect(h.replies().at(-1)).toBe(TEXT.unknown)
  })

  it("closes a draft owned by another chat", async () => {
    const h = harness()
    await toCard(h)
    h.agents.fail.confirm = new AgentsError(403, "not_your_draft", "This draft belongs to someone else")
    await h.press(`sell:ok:${ID}`)
    expect(h.replies().at(-1)).toBe(SELL_TEXT.gone)
  })

  it("offers the card again after a refusal, so the seller can retry", async () => {
    const h = harness()
    await toCard(h)
    h.agents.fail.confirm = new AgentsError(409, "InvalidFloor", "x")
    await h.press(`sell:ok:${ID}`)
    expect(h.replies().at(-2)).toMatch(/went wrong/)
    expect(keyboard(h)[0]!.callback_data).toBe(`sell:ok:${ID}`)
    delete h.agents.fail.confirm
    await h.press(`sell:ok:${ID}`)
    expect(h.replies().at(-1)).toMatch(/^Listed: lot #12/)
  })

  it("never offers List again when the confirm got no answer: it may have listed", async () => {
    const h = harness()
    await toCard(h)
    h.agents.fail.confirm = new AgentsError(0, "timeout", "x")
    await h.press(`sell:ok:${ID}`)
    expect(h.replies().at(-1)).toBe(SELL_TEXT.unsure)
    delete h.agents.fail.confirm
    await h.press(`sell:ok:${ID}`)
    expect(confirms(h)).toHaveLength(1)
  })
})
