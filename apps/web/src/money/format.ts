import type { Currency, DisplayCurrency } from "@fairtown/shared/keys"

/** Contract 5: money is bigint base units with 6 decimals. */
const DECIMALS = 6

/** Settlement currencies Intl knows as ISO 4217 codes. USDC is not one. */
const ISO_SETTLEMENT: Partial<Record<Currency, string>> = { USD: "USD", EUR: "EUR" }
const DEFAULT_LOCALE: Record<Currency, string> = { EUR: "en-IE", USD: "en-US", USDC: "en-US" }
const APPROX_LOCALE: Partial<Record<DisplayCurrency, string>> = { INR: "en-IN" }

type FormatOpts = { locale?: string }
type Decimal = `${number}`

const formatters = new Map<string, Intl.NumberFormat>()
function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(options)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, options)
    formatters.set(key, f)
  }
  return f
}

/** Exact decimal text for base units, e.g. `2702700000n` → `"2702.700000"`. No floats involved. */
export function toDecimalString(base: bigint, decimals = DECIMALS): string {
  const sign = base < 0n ? "-" : ""
  const digits = (base < 0n ? -base : base).toString().padStart(decimals + 1, "0")
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

// Intl.NumberFormat formats a numeric string as an exact decimal (ES2023), so bigint money never
// passes through a JS number on its way to the screen.
function formatIn(base: bigint, currency: Currency, locale: string, minDigits: number, maxDigits: number): string {
  const iso = ISO_SETTLEMENT[currency]
  const digits = { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits }
  const value = toDecimalString(base) as Decimal
  if (iso) return formatter(locale, { style: "currency", currency: iso, ...digits }).format(value)
  return `${currency} ${formatter(locale, { style: "decimal", ...digits }).format(value)}`
}

/** A money amount in the lot's own currency, e.g. `€2,702.70`. */
export function formatMoney(base: bigint, currency: Currency, opts: FormatOpts = {}): string {
  return formatIn(base, currency, opts.locale ?? DEFAULT_LOCALE[currency], 2, 2)
}

/** A price per unit, e.g. `€7.50/kg`. Keeps sub-cent floors down to the 0.001 product minimum. */
export function formatPerUnit(perUnit: bigint, currency: Currency, unit: string, opts: FormatOpts = {}): string {
  return `${formatIn(perUnit, currency, opts.locale ?? DEFAULT_LOCALE[currency], 2, DECIMALS)}/${unit}`
}

const usdRate = (code: string, perUsd: Record<string, number>): number | undefined =>
  perUsd[code] ?? (code === "USD" || code === "USDC" ? 1 : undefined)

/**
 * Local display through daily FX, e.g. `about NOK 31,815`. Display only, never a payout figure,
 * so this is the one place money becomes a JS number. Returns null when a rate is missing.
 */
export function formatApprox(
  base: bigint,
  from: Currency,
  to: DisplayCurrency,
  perUsd: Record<string, number>,
): string | null {
  const fromRate = usdRate(from, perUsd)
  const toRate = usdRate(to, perUsd)
  if (fromRate === undefined || toRate === undefined || fromRate <= 0) return null
  const amount = (Number(base) / 10 ** DECIMALS / fromRate) * toRate
  const locale = APPROX_LOCALE[to] ?? "en-US"
  const text = formatter(locale, {
    style: "currency",
    currency: to,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  }).format(amount)
  return `about ${text}`
}

/** Basis points as a percentage, e.g. `5000` → `50%`. */
export function formatBps(bps: number): string {
  return `${formatter("en-US", { maximumFractionDigits: 2 }).format(bps / 100)}%`
}
