/**
 * W1 pure helpers (S1 4.2): parse Frankfurter v2 FX rates and /api/reference prices, validate them, and encode
 * SignalOracle reports (contract 7.7 with ICR-005 `asOf`). No CRE SDK imports, so everything here is unit-tested with
 * plain `bun test`. Rules: never write an unparsed price, never write zero, skip what is missing, log source and date.
 */
import { encodeAbiParameters, stringToHex, type Hex } from "viem"
import { z } from "zod"

/** ChainWrite.TargetsLimit from `cre workflow limits export` (CLI v1.39.0): writes per execution. */
export const MAX_WRITES_PER_RUN = 10
export const FX_DECIMALS = 8 // perUsdE8
export const KIND_REFERENCE = 1
export const KIND_FX = 3
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DECIMAL = /^\d+(\.\d+)?$/
const CODE = /^[A-Z]{3,4}$/
const KEY = /^[a-z0-9_]{1,32}$/
// zod's .url() needs the URL built-in, which the CRE WASM runtime (Javy) lacks; a plain pattern works everywhere.
const HTTP_URL = /^https?:\/\/[^\s?#]+$/

// ------------------------------------------------------------------ config

export const PairSchema = z.object({ commodity: z.string().regex(KEY), market: z.string().regex(KEY) })
export type Pair = z.infer<typeof PairSchema>

export const ConfigSchema = z
  .object({
    fxSchedule: z.string().min(1),
    referenceSchedule: z.string().min(1),
    fxBaseUrl: z.string().regex(HTTP_URL),
    fxQuotes: z.array(z.string().regex(CODE)).min(1).max(MAX_WRITES_PER_RUN),
    referenceUrl: z.string().regex(HTTP_URL),
    pairs: z.array(PairSchema).min(1).max(MAX_WRITES_PER_RUN),
    chainSelectorName: z.string().min(1),
    signalOracle: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    gasLimit: z.string().regex(/^\d+$/),
  })
  .refine((c) => new Set(c.fxQuotes).size === c.fxQuotes.length, { message: "duplicate fxQuotes" })
  .refine((c) => new Set(c.pairs.map((p) => `${p.commodity}@${p.market}`)).size === c.pairs.length, {
    message: "duplicate pairs",
  })
export type Config = z.infer<typeof ConfigSchema>

// ------------------------------------------------------------------ decimals

/**
 * "0.88903" -> 88903000n at 8 decimals. Digits only, optional fraction; extra fraction digits round half up.
 * Returns null for anything else (signs, exponents, spaces, empty). Zero is returned as 0n; callers refuse to write it.
 */
export function scaleDecimal(text: string, decimals: number): bigint | null {
  if (!DECIMAL.test(text)) return null
  const [whole, frac = ""] = text.split(".") as [string, string?]
  const kept = frac.slice(0, decimals).padEnd(decimals, "0")
  let v = BigInt(whole + kept)
  if (frac.length > decimals && Number(frac[decimals]) >= 5) v += 1n
  return v
}

/**
 * A JSON number back to its decimal text. JS prints the shortest text that parses to the same double, which for the
 * short rates Frankfurter returns (a few significant digits) is exactly the text in the response. Exponent forms
 * (below 1e-6 or from 1e21) are refused rather than guessed.
 */
export function numberText(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null
  const s = String(n)
  return DECIMAL.test(s) ? s : null
}

// ------------------------------------------------------------------ FX (Frankfurter v2)

export type FxRate = { quote: string; perUsdE8: bigint; date: string }
export type Skip = { key: string; reason: string }

export function fxUrl(base: string, quotes: string[]): string {
  return `${base}?base=USD&quotes=${quotes.join(",")}`
}

/**
 * Frankfurter v2 `/v2/rates?base=USD&quotes=...` answers `[{date, base, quote, rate}]` (checked 2026-11-06; v1
 * `/latest` lacks KES and NGN). Keeps only requested quotes with base USD, a valid date and a positive rate.
 */
export function parseFrankfurterV2(body: string, quotes: string[]): { rates: FxRate[]; skipped: Skip[] } {
  const skipped: Skip[] = []
  let rows: unknown
  try {
    rows = JSON.parse(body)
  } catch {
    return { rates: [], skipped: quotes.map((q) => ({ key: q, reason: "body is not JSON" })) }
  }
  if (!Array.isArray(rows)) {
    return { rates: [], skipped: quotes.map((q) => ({ key: q, reason: "body is not an array" })) }
  }
  const found = new Map<string, FxRate>()
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue
    const r = row as Record<string, unknown>
    const quote = typeof r.quote === "string" ? r.quote : ""
    if (!quotes.includes(quote) || found.has(quote)) continue
    if (r.base !== "USD") {
      skipped.push({ key: quote, reason: `base ${String(r.base)} is not USD` })
      found.set(quote, { quote, perUsdE8: 0n, date: "" })
      continue
    }
    const date = typeof r.date === "string" && DATE.test(r.date) ? r.date : null
    const text = numberText(r.rate)
    const perUsdE8 = text === null ? null : scaleDecimal(text, FX_DECIMALS)
    if (date === null || perUsdE8 === null || perUsdE8 === 0n) {
      skipped.push({ key: quote, reason: `unparsed row ${JSON.stringify(r).slice(0, 120)}` })
      found.set(quote, { quote, perUsdE8: 0n, date: "" })
      continue
    }
    found.set(quote, { quote, perUsdE8, date })
  }
  const rates: FxRate[] = []
  for (const q of quotes) {
    const f = found.get(q)
    if (!f) skipped.push({ key: q, reason: "missing from response" })
    else if (f.perUsdE8 > 0n) rates.push(f)
  }
  return { rates, skipped }
}

// ------------------------------------------------------------------ reference prices (/api/reference)

export type Reference = Pair & {
  perUnit: bigint
  currency: string
  date: string
  source: string
  sourceUrl: string
}

/** Contract 11: `GET /api/reference?commodity=&market=` -> `{ perUnit, currency, date, source, sourceUrl }`. */
export function referenceUrl(base: string, pair: Pair): string {
  return `${base}?commodity=${encodeURIComponent(pair.commodity)}&market=${encodeURIComponent(pair.market)}`
}

const ReferenceBody = z.object({
  perUnit: z.string().regex(/^\d+$/), // base units, 6 decimals, as a decimal string (contract 5)
  currency: z.enum(["USD", "EUR", "USDC"]),
  date: z.string().regex(DATE),
  source: z.string().min(1).max(500),
  sourceUrl: z.string().max(500).default(""),
  commodity: z.string().optional(),
  market: z.string().optional(),
})

export function parseReference(body: string, pair: Pair): { ok: true; ref: Reference } | { ok: false; reason: string } {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return { ok: false, reason: "body is not JSON" }
  }
  const r = ReferenceBody.safeParse(json)
  if (!r.success)
    return { ok: false, reason: `invalid fields: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}` }
  const b = r.data
  if ((b.commodity && b.commodity !== pair.commodity) || (b.market && b.market !== pair.market)) {
    return { ok: false, reason: `answer is for ${b.commodity}@${b.market}` }
  }
  const perUnit = BigInt(b.perUnit)
  if (perUnit === 0n) return { ok: false, reason: "perUnit is zero" }
  return {
    ok: true,
    ref: { ...pair, perUnit, currency: b.currency, date: b.date, source: b.source, sourceUrl: b.sourceUrl },
  }
}

// ------------------------------------------------------------------ encoding (contract 7.7, ICR-005)

/** Keys as in @fairtown/shared/keys `toKey`: ASCII, left-aligned, zero-padded to 32 bytes. */
export function toBytes32(s: string): Hex {
  if (s.length === 0 || s.length > 32 || !/^[\x20-\x7e]+$/.test(s)) throw new Error(`not a bytes32 key: ${s}`)
  return stringToHex(s, { size: 32 })
}

/** The onchain source tag: where and when, short enough for bytes32 ("api:2026-11-05"). Full source goes to logs. */
export function sourceTag(date: string): Hex {
  return toBytes32(`api:${date}`)
}

const outer = (kind: number, body: Hex): Hex =>
  encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, body])

/** kind 3: abi.encode(bytes32 currencyCode, uint256 perUsdE8, uint64 asOf) */
export function encodeFxReport(rate: Pick<FxRate, "quote" | "perUsdE8">, asOf: bigint): Hex {
  if (rate.perUsdE8 <= 0n) throw new Error(`refusing to encode a zero rate for ${rate.quote}`)
  return outer(
    KIND_FX,
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [toBytes32(rate.quote), rate.perUsdE8, asOf],
    ),
  )
}

/** kind 1: abi.encode(bytes32 commodity, bytes32 market, uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 asOf) */
export function encodeReferenceReport(ref: Reference, asOf: bigint): Hex {
  if (ref.perUnit <= 0n) throw new Error(`refusing to encode a zero price for ${ref.commodity}@${ref.market}`)
  return outer(
    KIND_REFERENCE,
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint64" },
      ],
      [
        toBytes32(ref.commodity),
        toBytes32(ref.market),
        ref.perUnit,
        toBytes32(ref.currency),
        sourceTag(ref.date),
        asOf,
      ],
    ),
  )
}

/** Human-readable rate for logs: 88903000n -> "0.88903000". Display only. */
export function formatE8(v: bigint): string {
  const s = v.toString().padStart(FX_DECIMALS + 1, "0")
  return `${s.slice(0, -FX_DECIMALS)}.${s.slice(-FX_DECIMALS)}`
}
