import { GrammyError, HttpError } from "grammy"
import type { Chat } from "grammy/types"
import { describe, expect, it } from "vitest"
import { COMMANDS, TEXT } from "../src/bot"
import { ALICE, BOT_INFO, FAKE_TOKEN, MALLORY, harness } from "./harness"

const group: Chat.GroupChat = { id: -100200, type: "group", title: "Dock chat" }

describe("telegram bot: commands", () => {
  it("answers /start in the user's private chat, with the test-money label", async () => {
    const h = harness()
    await h.text("/start")
    expect(h.sent()).toHaveLength(1)
    expect(h.sent()[0]!.payload.chat_id).toBe(ALICE.id)
    expect(h.replies()[0]).toBe(TEXT.start)
    expect(TEXT.start).toMatch(/Test money only/)
  })

  it("lists every registered command in /help", async () => {
    const h = harness()
    await h.text("/help")
    for (const c of COMMANDS) expect(h.replies()[0]).toContain(`/${c.command}`)
  })

  it("accepts /start@botname and a deep-link payload", async () => {
    const h = harness()
    await h.text(`/start@${BOT_INFO.username}`)
    await h.text("/start ref_dock")
    expect(h.replies()).toEqual([TEXT.start, TEXT.start])
  })

  it("points unknown commands and plain text to /help", async () => {
    const h = harness()
    await h.text("/sell 600 kg cod")
    await h.text("hello")
    expect(h.replies()).toEqual([TEXT.unknown, TEXT.unknown])
  })

  it("answers a stale button press as expired instead of leaving the spinner", async () => {
    const h = harness()
    await h.press("confirm:old")
    expect(h.calls).toEqual([{ method: "answerCallbackQuery", payload: expect.objectContaining({ text: TEXT.expired }) }])
  })
})

describe("telegram bot: who it talks to", () => {
  it("ignores messages in groups and sends nothing there", async () => {
    const h = harness()
    await h.text("/start", ALICE, group)
    expect(h.calls).toEqual([])
  })

  it("leaves a group it is added to", async () => {
    const h = harness()
    await h.dispatch({
      my_chat_member: {
        chat: group,
        from: ALICE,
        date: 1,
        old_chat_member: { status: "left", user: BOT_INFO },
        new_chat_member: { status: "member", user: BOT_INFO },
      },
    })
    expect(h.calls.map((c) => c.method)).toEqual(["leaveChat"])
  })

  it("ignores other bots", async () => {
    const h = harness()
    await h.text("/start", { id: 777, is_bot: true, first_name: "spam_bot" })
    expect(h.calls).toEqual([])
  })

  it("turns away users outside the allowlist, for messages and buttons", async () => {
    const h = harness({ allowedUsers: new Set([ALICE.id]) })
    await h.text("/start", MALLORY)
    await h.press("x", MALLORY)
    expect(h.replies()).toEqual([TEXT.notAllowed])
    expect(h.calls[1]).toEqual({ method: "answerCallbackQuery", payload: expect.objectContaining({ text: TEXT.notAllowed }) })
    await h.text("/start", ALICE)
    expect(h.replies()[1]).toBe(TEXT.start)
  })

  it("lets anyone in when no allowlist is set", async () => {
    const h = harness()
    await h.text("/start", MALLORY)
    expect(h.replies()).toEqual([TEXT.start])
  })
})

describe("telegram bot: failures", () => {
  it("logs an internal error without the token and tells the user", async () => {
    let first = true
    const h = harness({}, (c) => {
      if (c.method !== "sendMessage" || !first) return undefined
      first = false
      return new Error(`exploded calling https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`)
    })
    await h.text("/start")
    const err = h.logs.find((l) => l.level === "error")!
    expect(err.extra).toMatchObject({ kind: "internal" })
    expect(JSON.stringify(h.logs)).not.toContain(FAKE_TOKEN)
    expect(JSON.stringify(h.logs)).toContain("<token>")
    expect(h.replies().at(-1)).toBe(TEXT.failed)
  })

  it("logs a Telegram API rejection and still tries to apologise", async () => {
    let first = true
    const h = harness({}, (c) => {
      if (c.method !== "sendMessage" || !first) return undefined
      first = false
      return new GrammyError("Call to 'sendMessage' failed!", { ok: false, error_code: 400, description: "Bad Request: message is too long" }, "sendMessage", {})
    })
    await h.text("/start")
    expect(h.logs.find((l) => l.level === "error")!.extra).toMatchObject({ kind: "telegram", detail: "Bad Request: message is too long" })
    expect(h.replies()).toEqual([TEXT.start, TEXT.failed])
  })

  it("does not retry a reply when Telegram itself is unreachable", async () => {
    const h = harness({}, (c) => (c.method === "sendMessage" ? new HttpError("Network request for 'sendMessage' failed!", new Error("ECONNRESET")) : undefined))
    await h.text("/help")
    expect(h.logs.find((l) => l.level === "error")!.extra).toMatchObject({ kind: "network" })
    expect(h.sent()).toHaveLength(1) // the failed /help reply, no apology attempt
  })

  it("survives the apology failing too", async () => {
    const h = harness({}, (c) => (c.method === "sendMessage" ? new Error("down") : undefined))
    await expect(h.text("/start")).resolves.toBeUndefined()
    expect(h.sent()).toHaveLength(2)
  })
})
