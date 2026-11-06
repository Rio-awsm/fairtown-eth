import { decodeTicket, toTicketJson, type TicketJson } from "@fairtown/shared/handover"
import type { LotStatus } from "@fairtown/shared/keys"
import type { LotState, TownState } from "../game/reducer"
import { unitLabel } from "../money/format"

/** QR handover (S3 2.2) logic, kept pure. Every message is plain words: no crypto terms on /scan. */

const LOT_UNITS = 10n ** 18n
/** Lots waiting for goods to change hands. */
// A lot waits for handovers until it is paid in full: after one buyer of several collects, the contract already says
// `delivered` (or `picked_up` by a carrier) while others still hold tokens (C 1.3). Spent codes fail on chain.
const AWAITING: ReadonlySet<LotStatus> = new Set(["sold", "truck_booked", "picked_up", "delivered"])
// A no-show is about the seller: once a carrier has picked up, the seller showed.
const NO_SHOW_OPEN: ReadonlySet<LotStatus> = new Set(["sold", "truck_booked"])

export type ReadResult = { ok: true; ticket: TicketJson } | { ok: false; error: string }
const NOT_OURS: ReadResult = { ok: false, error: "This isn't a Fairtown handover code." }

/** A scanned QR or a pasted fallback link (`…/scan?code=<ticket JSON>`) into a ticket. */
/** The QR text inside a fallback link: the server's `#t=<base64url>` (ICR-009), or the older `?code=<text>`. */
function linkCode(link: string): string | null {
  const url = new URL(link, "http://fallback.local")
  const t = new URLSearchParams(url.hash.slice(1)).get("t")
  if (t) {
    try {
      const b64 = t.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(t.length / 4) * 4, "=")
      return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    } catch {
      return null
    }
  }
  return url.searchParams.get("code")
}

export function readCode(text: string): ReadResult {
  let payload = text.trim()
  if (/^(https?:\/\/|\/|#)/.test(payload)) {
    const code = linkCode(payload)
    if (!code) return NOT_OURS
    payload = code
  }
  try {
    return { ok: true, ticket: toTicketJson(decodeTicket(payload)) }
  } catch {
    return NOT_OURS
  }
}

export type CheckResult = { ok: true; lot: LotState } | { ok: false; error: string }

/** Whether this person may accept this code now. Nothing is sent on scan; this only decides what to show. */
export function checkTicket(ticket: TicketJson, town: TownState, receiverId: string): CheckResult {
  const lot = town.lots[ticket.lotId]
  if (!lot) return { ok: false, error: `We can't find Lot ${ticket.lotId} yet. Wait a moment, then scan again.` }
  if (BigInt(ticket.expiryBlock) <= BigInt(town.block))
    return { ok: false, error: "This code has expired. Ask for a new one." }
  if (!AWAITING.has(lot.status))
    return { ok: false, error: `This code is for Lot ${lot.lotId}, which isn't waiting for a handover.` }
  const receiver = receiverId.toLowerCase()
  if (receiver !== ticket.buyer.toLowerCase() && receiver !== lot.carrier?.toLowerCase())
    return { ok: false, error: "This code is for someone else. Check you picked the right name." }
  return { ok: true, lot }
}

/** Plain words for a scanner camera failure: blocked by permission, or simply not started. */
export function cameraProblem(error: unknown): string {
  const e = error as { name?: string; kind?: string; cause?: { name?: string } } | undefined
  const names = [e?.name, e?.kind, e?.cause?.name].map((n) => (n ?? "").toLowerCase())
  if (names.some((n) => n.includes("notallowed") || n.includes("permission") || n.includes("security")))
    return "The camera is blocked. Allow it in your phone settings, or open the link under the seller's code."
  return "The camera did not start. Try again, or open the link under the seller's code."
}

/** "600 kg cod from Ingrid Solheim, Lot 12." */
export function describeTicket(ticket: TicketJson, lot: LotState): string {
  const units = BigInt(ticket.tokenAmount) / LOT_UNITS
  return `${units} ${unitLabel(lot.unit)} ${lot.commodity} from ${lot.sellerName}, Lot ${lot.lotId}.`
}

export type HandoverParty = { buyer: string; tokenAmount: string }

/**
 * Who a seller can show a code to, and for how much of the lot. From the API's `winners` when it
 * has them; otherwise only when a single bidder won everything. Never guesses between bidders.
 */
export function handoverParties(lot: LotState, winners: HandoverParty[] | undefined): HandoverParty[] {
  if (winners && winners.length > 0) return winners
  if (!lot.settlement) return []
  const bidders = [...new Set(lot.bidLog.map((b) => b.agentId.toLowerCase()))]
  if (bidders.length !== 1) return []
  return [{ buyer: lot.bidLog[0]!.agentId, tokenAmount: (BigInt(lot.settlement.soldUnits) * LOT_UNITS).toString() }]
}

/** "Seller didn't come" shows only after the pickup deadline, while the lot still waits for a handover. */
export function noShowReportable(lot: LotState, block: number): boolean {
  return NO_SHOW_OPEN.has(lot.status) && lot.deadlineBlock !== undefined && block > lot.deadlineBlock
}
