export type ClearingBid = { id: bigint; maxPerUnit: bigint; amount: bigint }
export type Fill = { id: bigint; units: bigint; paid: bigint }
export type ClearingResult = { clearingPerUnit: bigint; fills: Fill[] }

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

// Uniform-price clearing. The price is the lowest p >= floor at which demand (sum of amount / p over
// bids with maxPerUnit >= p) fits in qty. If even the marginal bid's own price leaves demand above qty,
// the price stops there and the marginal tier is filled in bid order (time priority).
export function computeClearing(bids: ClearingBid[], qty: bigint, floorPerUnit: bigint): ClearingResult {
  const sorted = [...bids].sort((a, b) => (a.maxPerUnit === b.maxPerUnit ? 0 : a.maxPerUnit > b.maxPerUnit ? -1 : 1))
  let price = floorPerUnit
  let active = 0n
  for (let i = 0; i < sorted.length; i++) {
    const bid = sorted[i]!
    if (bid.maxPerUnit < floorPerUnit) break
    active += bid.amount
    const next = sorted[i + 1]?.maxPerUnit ?? 0n
    const fitPrice = ceilDiv(active, qty)
    if (fitPrice > next) {
      price = fitPrice > bid.maxPerUnit ? bid.maxPerUnit : fitPrice
      if (price < floorPerUnit) price = floorPerUnit
      break
    }
    price = floorPerUnit
  }
  let left = qty
  const fills: Fill[] = []
  for (const bid of bids.filter((b) => b.maxPerUnit >= price).sort((a, b) => (a.maxPerUnit > b.maxPerUnit ? -1 : a.maxPerUnit < b.maxPerUnit ? 1 : 0))) {
    const want = bid.amount / price
    const units = want < left ? want : left
    left -= units
    fills.push({ id: bid.id, units, paid: units * price })
  }
  return { clearingPerUnit: price, fills }
}
