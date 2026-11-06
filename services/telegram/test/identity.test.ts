import { GrammyError } from "grammy"
import { describe, expect, it } from "vitest"
import { AgentsError } from "../src/agents"
import { TEXT } from "../src/bot"
import { ID_TEXT } from "../src/identity"
import { PIN_WAIT_MS } from "../src/links"
import { ALICE, MALLORY, PIN, harness } from "./harness"

type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
const buttons = (payload: Record<string, unknown>) => (payload.reply_markup as Keyboard).inline_keyboard.flat().map((b) => b.callback_data)

async function signIn(h: ReturnType<typeof harness>, id = "ingrid", pin = PIN, from = ALICE) {
  await h.text(`/link ${id}`, from)
  await h.text(pin, from)
}

describe("roles", () => {
  it("offers the three roles on /start", async () => {
    const h = harness()
    await h.text("/start")
    expect(buttons(h.sent()[0]!.payload)).toEqual(["role:sell", "role:buy", "role:drive"])
  })

  it("explains how sellers and drivers sign in, and asks buyers for a currency", async () => {
    const h = harness()
    await h.press("role:sell")
    await h.press("role:drive")
    await h.press("role:buy")
    expect(h.replies().slice(0, 2)).toEqual([ID_TEXT.sellHint, ID_TEXT.driveHint])
    expect(buttons(h.sent()[2]!.payload)).toEqual(["join:USD", "join:EUR"])
    expect(h.calls.filter((c) => c.method === "answerCallbackQuery")).toHaveLength(3)
  })
})

describe("seller and driver sign-in", () => {
  it("signs in with /link and the PIN, deletes the PIN message and never echoes the PIN", async () => {
    const h = harness()
    await h.text("/link ingrid")
    expect(h.replies()[0]).toBe(ID_TEXT.askPin("ingrid"))
    expect(h.sent()[0]!.payload.reply_markup).toMatchObject({ force_reply: true })
    await h.text(PIN)
    const del = h.calls.find((c) => c.method === "deleteMessage")!
    expect(del.payload).toMatchObject({ chat_id: ALICE.id })
    expect(h.agents.calls[0]).toEqual({ fn: "sellerSession", user: ALICE.id, args: ["ingrid", PIN] })
    expect(h.replies()[1]).toBe("Signed in as Ingrid Solheim (seller, id ingrid). Your session lasts 120 minutes.\nTo sell, send a photo of your lot with a description as the caption, for example: 600 kg cod, Bergen")
    expect(h.links.session(ALICE.id)).toBe(`seller-session-ingrid-${ALICE.id}`)
    expect(JSON.stringify(h.sent())).not.toContain(PIN)
    expect(JSON.stringify(h.logs)).not.toContain(PIN)
  })

  it("labels a truck account as a driver", async () => {
    const h = harness()
    await signIn(h, "lars")
    expect(h.replies()[1]).toMatch(/^Signed in as Lars \(driver, id lars\)/)
    expect(h.links.get(ALICE.id)).toMatchObject({ role: "TRUCK", sellerId: "lars" })
  })

  it("lowercases the id and rejects ids that can't be seller ids", async () => {
    const h = harness()
    await h.text("/link")
    await h.text("/link ../admin")
    await h.text("/link Ingrid")
    expect(h.replies()).toEqual([ID_TEXT.linkUsage, ID_TEXT.badId, ID_TEXT.askPin("ingrid")])
  })

  it("uses a PIN wait once: after a wrong PIN, the next message is just a message", async () => {
    const h = harness()
    await signIn(h, "ingrid", "0000")
    expect(h.replies()[1]).toBe("That PIN didn't work. Send /link ingrid to try again.")
    await h.text(PIN)
    expect(h.replies()[2]).toBe(TEXT.unknown)
    expect(h.agents.calls.filter((c) => c.fn === "sellerSession")).toHaveLength(1)
    expect(h.links.get(ALICE.id)).toBeUndefined()
  })

  it("lets the PIN wait expire after two minutes", async () => {
    const h = harness()
    await h.text("/link ingrid")
    h.tick(PIN_WAIT_MS + 1)
    await h.text(PIN)
    expect(h.replies()[1]).toBe(TEXT.unknown)
    expect(h.agents.calls).toEqual([])
  })

  it("keeps the PIN wait across other commands, and /cancel ends it", async () => {
    const h = harness()
    await h.text("/link ingrid")
    await h.text("/help")
    await h.text(PIN)
    expect(h.replies()[2]).toMatch(/^Signed in/)
    await h.text("/logout")
    await h.text("/link ingrid")
    await h.text("/cancel")
    await h.text(PIN)
    await h.text("/cancel")
    expect(h.replies().slice(-3)).toEqual([ID_TEXT.cancelled, TEXT.unknown, ID_TEXT.nothingToCancel])
  })

  it("does not take another user's message as the PIN", async () => {
    const h = harness()
    await h.text("/link ingrid", ALICE)
    await h.text(PIN, MALLORY)
    expect(h.agents.calls).toEqual([])
    expect(h.links.isWaiting(ALICE.id)).toBe(true)
  })

  it("asks the user to delete the PIN themselves if Telegram won't", async () => {
    const h = harness({}, (c) => (c.method === "deleteMessage" ? new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" }, "deleteMessage", {}) : undefined))
    await signIn(h)
    expect(h.replies()[1]).toMatch(/^Signed in/)
    expect(h.replies()[1]).toContain(ID_TEXT.deleteYourself)
  })

  it("explains each refusal from the agents service", async () => {
    const cases: Array<[AgentsError, RegExp]> = [
      [new AgentsError(429, "rate_limited", "x"), /Too many tries/],
      [new AgentsError(503, "sessions_disabled", "x"), /switched off/],
      [new AgentsError(0, "unreachable", "x"), /isn't answering/],
      [new AgentsError(0, "timeout", "x"), /isn't answering/],
      [new AgentsError(500, "internal", "x"), /went wrong/],
    ]
    for (const [err, want] of cases) {
      const h = harness()
      h.agents.fail.sellerSession = err
      await signIn(h)
      expect(h.replies()[1]).toMatch(want)
      expect(h.links.get(ALICE.id)).toBeUndefined()
      expect(h.logs.find((l) => l.level === "warn")!.extra).toEqual({ status: err.status, code: err.code })
    }
    const h = harness()
    await signIn(h, "nobody")
    expect(h.replies()[1]).toBe('There\'s no seller or truck account called "nobody".')
  })

  it("logs an error when the agents service refuses the bot's service token", async () => {
    const h = harness()
    h.agents.fail.sellerSession = new AgentsError(401, "bad_service_token", "Unknown service token")
    await signIn(h)
    expect(h.replies()[1]).toMatch(/isn't connected to the market/)
    expect(h.logs.some((l) => l.level === "error" && /TELEGRAM_SERVICE_TOKEN/.test(l.msg))).toBe(true)
  })

  it("does not sign in when the profile lookup fails after the session", async () => {
    const h = harness()
    h.agents.fail.seller = new AgentsError(0, "unreachable", "x")
    await signIn(h)
    expect(h.links.get(ALICE.id)).toBeUndefined()
    expect(h.replies()[1]).toMatch(/isn't answering/)
  })

  it("hands a bug (not an agents refusal) to the bot's error handler", async () => {
    const h = harness()
    h.agents.fail.sellerSession = new TypeError("boom")
    await signIn(h)
    expect(h.logs.find((l) => l.level === "error")!.extra).toMatchObject({ kind: "internal" })
    expect(h.replies().at(-1)).toBe(TEXT.failed)
  })

  it("needs /logout before signing in as someone else, but can renew the same account", async () => {
    const h = harness()
    await signIn(h)
    await h.text("/link lars")
    expect(h.replies().at(-1)).toBe("You're signed in as Ingrid Solheim (seller, id ingrid). Send /logout first.")
    await signIn(h)
    expect(h.replies().at(-1)).toMatch(/^Signed in as Ingrid/)
  })
})

describe("buyers join as walk-ins", () => {
  it("joins with the chosen currency and shows the test money", async () => {
    const h = harness()
    await h.press("join:EUR")
    expect(h.agents.calls[0]).toEqual({ fn: "walkin", user: ALICE.id, args: ["Alice", "EUR"] })
    expect(h.replies()[0]).toBe("You're in as Alice, a buyer with 500 EUR of test money. Your visit lasts 2 hours. See /market to bid.")
    expect(h.links.get(ALICE.id)).toMatchObject({ role: "HUMAN", currency: "EUR" })
    expect(h.links.session(ALICE.id)).toBe("walkin-session-1")
  })

  it("does not join twice", async () => {
    const h = harness()
    await h.press("join:USD")
    await h.press("join:EUR")
    expect(h.replies()[1]).toBe("You're already in as Alice (buyer). Send /logout to leave.")
    expect(h.agents.calls.filter((c) => c.fn === "walkin")).toHaveLength(1)
  })

  it("makes one wallet even when the button is tapped twice at once", async () => {
    const h = harness()
    let open!: () => void
    h.agents.walkinGate = new Promise((r) => (open = r))
    const first = h.press("join:USD")
    await new Promise((r) => setTimeout(r, 0))
    const second = h.press("join:USD")
    await new Promise((r) => setTimeout(r, 0))
    open()
    await Promise.all([first, second])
    expect(h.agents.calls.filter((c) => c.fn === "walkin")).toHaveLength(1)
    expect(h.replies()).toContain(ID_TEXT.busy)
  })

  it("keeps a join that worked when the budget lookup fails", async () => {
    const h = harness()
    h.agents.fail.agent = new AgentsError(0, "timeout", "x")
    await h.press("join:USD")
    expect(h.replies()[0]).toBe("You're in as Alice, a buyer. Your visit lasts 2 hours. See /market to bid.")
    expect(h.links.session(ALICE.id)).toBe("walkin-session-1")
  })

  it("explains a full market and leaves the user signed out", async () => {
    const h = harness()
    h.agents.fail.walkin = new AgentsError(503, "walkin_full", "x")
    await h.press("join:USD")
    expect(h.replies()[0]).toMatch(/market is full/)
    expect(h.links.get(ALICE.id)).toBeUndefined()
  })

  it("needs /logout before a signed-in seller joins as a buyer", async () => {
    const h = harness()
    await signIn(h)
    await h.press("join:USD")
    expect(h.replies().at(-1)).toMatch(/Send \/logout first/)
    expect(h.agents.calls.some((c) => c.fn === "walkin")).toBe(false)
  })
})

describe("whoami, logout and session ends", () => {
  it("offers the roles when nobody is signed in", async () => {
    const h = harness()
    await h.text("/whoami")
    expect(h.replies()[0]).toBe(ID_TEXT.notSignedIn)
    expect(buttons(h.sent()[0]!.payload)).toEqual(["role:sell", "role:buy", "role:drive"])
  })

  it("shows the minutes left, then how to sign in again once the session ends", async () => {
    const h = harness()
    await signIn(h)
    h.tick(30 * 60_000)
    await h.text("/whoami")
    expect(h.replies().at(-1)).toBe("You're Ingrid Solheim (seller, id ingrid). Your session ends in 90 minutes.")
    h.tick(90 * 60_000)
    await h.text("/whoami")
    expect(h.replies().at(-1)).toBe("You were signed in as Ingrid Solheim (seller, id ingrid), but the session ended. Send /link ingrid to sign in again.")
    expect(h.links.session(ALICE.id)).toBeUndefined()
  })

  it("ends a walk-in visit before the agents service does, then offers a new one", async () => {
    const h = harness()
    await h.press("join:USD")
    h.tick(119 * 60_000)
    await h.text("/whoami")
    expect(h.replies().at(-1)).toBe("Your visit as Alice has ended. Send /join to start a new one.")
    await h.press("join:USD")
    expect(h.agents.calls.filter((c) => c.fn === "walkin")).toHaveLength(2)
  })

  it("signs out, and says so when there was nothing to sign out of", async () => {
    const h = harness()
    await signIn(h)
    await h.text("/logout")
    await h.text("/logout")
    expect(h.replies().slice(-2)).toEqual([ID_TEXT.loggedOut, ID_TEXT.notLinked])
    expect(h.links.get(ALICE.id)).toBeUndefined()
  })
})
