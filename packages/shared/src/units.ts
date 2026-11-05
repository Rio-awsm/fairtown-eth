import { parseUnits } from "viem"
import { z } from "zod"

export const Q96 = 2n ** 96n
export const UNIT = 10n ** 18n
export const toQ96 = (perUnit: bigint) => (perUnit * Q96) / UNIT
export const fromQ96 = (q: bigint) => (q * UNIT) / Q96
export const tickFor = (floorQ96: bigint) => (floorQ96 / 100n > 2n ? floorQ96 / 100n : 2n)
export const floorToTick = (q: bigint, tick: bigint) => (q / tick) * tick
export const ceilToTick = (q: bigint, tick: bigint) => ((q + tick - 1n) / tick) * tick
export const toBase = (amount: string) => parseUnits(amount, 6)
export const splitPayout = (raised: bigint, feeBps: bigint, advanceBps: bigint) => {
  const fee = (raised * feeBps) / 10000n
  const net = raised - fee
  const advance = (net * advanceBps) / 10000n
  return { fee, advance, held: net - advance }
}

export const Dec = z.string().regex(/^\d+$/)
