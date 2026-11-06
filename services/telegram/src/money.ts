// Base units (6 decimals, bigint) to a display string, exactly: never through a JS number.
export function formatBase(v: bigint): string {
  const neg = v < 0n
  const a = neg ? -v : v
  const whole = (a / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "")
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`
}

export const formatMoney = (v: bigint | string, currency: string) => `${formatBase(typeof v === "string" ? BigInt(v) : v)} ${currency}`
