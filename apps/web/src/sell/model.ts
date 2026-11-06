import type { Currency, DisplayCurrency } from "@fairtown/shared/keys"
import { splitPayout } from "@fairtown/shared/units"
import { parseUnits } from "viem"
import { formatApprox, formatMoney } from "../money/format"

/** Seller chat (S3 2.1) logic, kept pure. No crypto words in anything a seller reads. */

/** Platform fee, 1% (D-09, FEE_BPS). */
export const FEE_BPS = 100n
/** Product minimum price per unit: 0.001 (contract 5). */
export const MIN_PER_UNIT = 1_000n
/** Auction length for a new listing: about 5 minutes at 2 s per block. */
export const DURATION_BLOCKS = 150
/** D-08: English browser speech first. */
export const SPEECH_LANGUAGE = "en-US"

export type DemoSeller = { id: string; name: string; place: string; what: string }
/** Demo sellers from source of truth 5. Their ids are what the agents API takes as `sellerId`. */
export const DEMO_SELLERS: readonly DemoSeller[] = [
  { id: "ingrid", name: "Ingrid Solheim", place: "Bergen", what: "Fish boat" },
  { id: "maya", name: "Maya Torres", place: "Dallas", what: "Truck space" },
  { id: "lars", name: "Lars", place: "Bergen", what: "Reefer truck" },
  { id: "ganesh", name: "Ganesh Pawar", place: "Pune", what: "Marigolds" },
  { id: "northlight", name: "Northlight Compute", place: "Data centre", what: "GPU hours" },
  { id: "wanjiru", name: "Wanjiru Kamau", place: "Naivasha", what: "Roses" },
  { id: "amina", name: "Amina Bello", place: "Lagos", what: "Tomatoes" },
]

export type PayoutPreview = { raised: bigint; fee: bigint; atSale: bigint; atHandover: bigint }

/** What the seller gets if the lot sells at the floor: the honest minimum. */
export function previewPayout(opts: { floorPerUnit: bigint; qty: bigint; advanceBps: number }): PayoutPreview {
  const raised = opts.floorPerUnit * opts.qty
  const { fee, advance, held } = splitPayout(raised, FEE_BPS, BigInt(opts.advanceBps))
  return { raised, fee, atSale: advance, atHandover: held }
}

/** "At least €2,227.50 at sale, about NOK 26,222, and the rest at handover." */
export function previewText(
  p: PayoutPreview,
  currency: Currency,
  display: DisplayCurrency | undefined,
  perUsd: Record<string, number>,
): string {
  const local = display && display !== currency ? formatApprox(p.atSale, currency, display, perUsd) : null
  return `At least ${formatMoney(p.atSale, currency)} at sale${local ? `, ${local}` : ""}, and the rest at handover.`
}

export type FloorInput = { ok: true; value: bigint } | { ok: false; error: string }

/** Reads a price the seller typed ("7.50" or "7,50") into base units. */
export function parseFloorInput(input: string): FloorInput {
  const text = input.trim().replace(",", ".")
  if (text === "") return { ok: false, error: "Enter a price" }
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Enter a price like 7.50" }
  if ((text.split(".")[1] ?? "").length > 6) return { ok: false, error: "Use at most 6 decimals" }
  const value = parseUnits(text, 6)
  if (value < MIN_PER_UNIT) return { ok: false, error: "The lowest price is 0.001" }
  return { ok: true, value }
}

export type VoiceMode = "speech" | "record" | "none"

/** Browser speech if there is any, else record and send to /api/stt, else no mic button. */
export function voiceMode(win: object): VoiceMode {
  if ("SpeechRecognition" in win || "webkitSpeechRecognition" in win) return "speech"
  if ("MediaRecorder" in win) return "record"
  return "none"
}

/** A random 4-digit code the seller holds up in each photo, so photos are fresh. */
export function newLotCode(random: () => number = Math.random): string {
  return String(Math.min(9999, Math.floor(random() * 10_000))).padStart(4, "0")
}
