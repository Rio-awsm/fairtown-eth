import type { TownEvent } from "@fairtown/shared/protocol"
import { describe, expect, it } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { BUYER, SAMPLE_EVENTS as S, TRUCK } from "../test/samples"
import { cameraProblem, checkTicket, describeTicket, handoverParties, noShowReportable, readCode } from "./model"

const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const UNITS = 10n ** 18n
const SIG = `0x${"cd".repeat(65)}`
const ticket = { lotId: "12", buyer: BUYER, tokenAmount: (600n * UNITS).toString(), expiryBlock: "1200", sig: SIG }
const json = JSON.stringify(ticket)
const sold = () => ({ ...run([S["lot.listed"], S["bid.placed"], S["lot.settled"]]), block: 1100 })

describe("readCode", () => {
  it("reads the ticket JSON a QR code holds", () => {
    expect(readCode(json)).toEqual({ ok: true, ticket })
  })

  it("reads the fallback link form", () => {
    expect(readCode(`https://x.trycloudflare.com/scan?code=${encodeURIComponent(json)}`)).toEqual({ ok: true, ticket })
    expect(readCode(`/scan?code=${encodeURIComponent(json)}`)).toEqual({ ok: true, ticket })
  })

  it("reads the server's fallback link: /scan#t=<base64url of the QR text> (ICR-009)", () => {
    const t = Buffer.from(json).toString("base64url")
    expect(readCode(`https://x.trycloudflare.com/scan#t=${t}`)).toEqual({ ok: true, ticket })
    expect(readCode(`#t=${t}`)).toEqual({ ok: true, ticket })
  })

  it("rejects a fallback link whose code is not base64url ticket text", () => {
    expect(readCode("/scan#t=%%%")).toEqual({ ok: false, error: "This isn't a Fairtown handover code." })
    expect(readCode(`/scan#t=${Buffer.from("hello").toString("base64url")}`).ok).toBe(false)
  })

  it.each(["hello", "https://example.com/menu", "{}", JSON.stringify({ ...ticket, sig: "0x12" })])(
    "rejects %s",
    (text) => {
      expect(readCode(text)).toEqual({ ok: false, error: "This isn't a Fairtown handover code." })
    },
  )
})

describe("checkTicket", () => {
  it("accepts the buyer collecting a sold lot", () => {
    expect(checkTicket(ticket, sold(), BUYER)).toMatchObject({ ok: true, lot: { lotId: "12" } })
  })

  it("accepts the assigned truck collecting for the buyer", () => {
    const town = { ...run([S["carrier.assigned"]], sold()), block: 1100 }
    expect(checkTicket(ticket, town, TRUCK)).toMatchObject({ ok: true })
  })

  it("rejects an expired code", () => {
    expect(checkTicket(ticket, { ...sold(), block: 1200 }, BUYER)).toEqual({
      ok: false,
      error: "This code has expired. Ask for a new one.",
    })
  })

  it("accepts the next buyer's code after another buyer of the lot collected (status delivered)", () => {
    const town = { ...run([S["handover.confirmed"], S["lot.delivered"]], sold()), block: 1100 }
    expect(checkTicket(ticket, town, BUYER).ok).toBe(true)
  })

  it("rejects a code for a lot that is not waiting for a handover", () => {
    const town = { ...run([S["handover.confirmed"], S["lot.delivered"], S["lot.paid_in_full"]], sold()), block: 1100 }
    expect(checkTicket(ticket, town, BUYER)).toEqual({
      ok: false,
      error: "This code is for Lot 12, which isn't waiting for a handover.",
    })
  })

  it("rejects a code for someone else", () => {
    expect(checkTicket(ticket, sold(), TRUCK)).toEqual({
      ok: false,
      error: "This code is for someone else. Check you picked the right name.",
    })
  })

  it("asks to wait when the lot has not reached this phone yet", () => {
    expect(checkTicket({ ...ticket, lotId: "99" }, sold(), BUYER)).toEqual({
      ok: false,
      error: "We can't find Lot 99 yet. Wait a moment, then scan again.",
    })
  })
})

describe("describeTicket", () => {
  it("says what changes hands, in plain words", () => {
    expect(describeTicket(ticket, sold().lots["12"]!)).toBe("600 kg cod from Ingrid Solheim, Lot 12.")
  })
})

describe("handoverParties", () => {
  it("uses the winners the API gives", () => {
    const winners = [{ buyer: TRUCK, tokenAmount: "1" }]
    expect(handoverParties(sold().lots["12"]!, winners)).toEqual(winners)
  })

  it("falls back to the only bidder getting every sold unit", () => {
    expect(handoverParties(sold().lots["12"]!, undefined)).toEqual([
      { buyer: BUYER, tokenAmount: (600n * UNITS).toString() },
    ])
  })

  it("never guesses between several bidders", () => {
    const two = run([{ ...S["bid.placed"], agentId: TRUCK }], sold())
    expect(handoverParties(two.lots["12"]!, undefined)).toEqual([])
  })

  it("has nobody before the sale", () => {
    expect(handoverParties(run([S["lot.listed"], S["bid.placed"]]).lots["12"]!, undefined)).toEqual([])
  })
})

describe("noShowReportable", () => {
  it("only after the pickup deadline, while the lot still waits for a handover", () => {
    const town = sold()
    const lot = town.lots["12"]!
    expect(noShowReportable(lot, 1200)).toBe(false)
    expect(noShowReportable(lot, 1201)).toBe(true)
    expect(noShowReportable({ ...lot, status: "picked_up" }, 1300)).toBe(false)
  })
})

describe("cameraProblem", () => {
  it("says blocked only when permission is the problem", () => {
    expect(cameraProblem(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toMatch(/^The camera is blocked/)
    expect(cameraProblem({ kind: "permission-denied", cause: { name: "NotAllowedError" } })).toMatch(
      /^The camera is blocked/,
    )
  })

  it("says it did not start for anything else", () => {
    expect(cameraProblem({ kind: "overconstrained", cause: { name: "OverconstrainedError" } })).toBe(
      "The camera did not start. Try again, or open the link under the seller's code.",
    )
    expect(cameraProblem(undefined)).toMatch(/^The camera did not start/)
  })
})
