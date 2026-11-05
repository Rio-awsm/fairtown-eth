import type { Grade } from "@fairtown/shared"

export type FloorInput = {
  reference?: bigint
  recent: bigint[]
  grade: Grade
  hoursToExpiry?: number
}
export type FloorResult = { floorPerUnit: bigint; basis: string[] }

const MIN_PER_UNIT = 1_000n
const GRADE_BPS: Partial<Record<Grade, bigint>> = {
  fresh_e: 10500n,
  extra: 10500n,
  fresh_b: 9000n,
  class_2: 9000n,
  bloom_b: 9000n,
  unfit: 5000n,
}
const median = (xs: bigint[]) => {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n
}
const fmt = (v: bigint) => (Number(v) / 1e6).toFixed(2)

// Blend of oracle reference and the last 10 clears, discounted so the auction opens below the expected price.
export function suggestFloor(i: FloorInput): FloorResult | null {
  const recent = i.recent.slice(-10)
  const basis: string[] = []
  let base: bigint
  if (i.reference !== undefined && recent.length) {
    const m = median(recent)
    base = (i.reference + m) / 2n
    basis.push(`Reference ${fmt(i.reference)} and median of last ${recent.length} clears ${fmt(m)}, averaged: ${fmt(base)}`)
  } else if (i.reference !== undefined) {
    base = i.reference
    basis.push(`Reference ${fmt(base)} (no recent clears yet)`)
  } else if (recent.length) {
    base = median(recent)
    basis.push(`Median of last ${recent.length} clears ${fmt(base)} (no reference)`)
  } else {
    return null
  }
  const gradeBps = GRADE_BPS[i.grade] ?? 10000n
  if (gradeBps !== 10000n) basis.push(`Grade ${i.grade}: ${gradeBps > 10000n ? "+" : ""}${Number(gradeBps - 10000n) / 100}%`)
  let discountBps = 1000n
  if (i.hoursToExpiry !== undefined && i.hoursToExpiry < 6) discountBps += 500n
  basis.push(`Opening ${Number(discountBps) / 100}% below${discountBps > 1000n ? ", short time left" : ""}`)
  const raw = (base * gradeBps * (10000n - discountBps)) / 10000n / 10000n
  const floorPerUnit = raw > MIN_PER_UNIT ? (raw / 10_000n) * 10_000n || raw : MIN_PER_UNIT
  return { floorPerUnit, basis }
}
