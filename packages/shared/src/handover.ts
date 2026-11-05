import type { Address, Hex } from "viem"
import { z } from "zod"
import { Dec } from "./units"

export const HANDOVER_TYPES = {
  Handover: [
    { name: "lotId", type: "uint256" },
    { name: "buyer", type: "address" },
    { name: "tokenAmount", type: "uint256" },
    { name: "expiryBlock", type: "uint64" },
  ],
} as const

export const handoverDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "Fairtown", version: "1", chainId, verifyingContract }) as const

export type HandoverMessage = { lotId: bigint; buyer: Address; tokenAmount: bigint; expiryBlock: bigint }
export type HandoverTicket = HandoverMessage & { sig: Hex }

const MAX_UINT64 = 2n ** 64n - 1n

export const TicketJson = z.strictObject({
  lotId: Dec,
  buyer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenAmount: Dec,
  expiryBlock: Dec.refine((v) => BigInt(v) <= MAX_UINT64, "expiryBlock exceeds uint64"),
  sig: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "sig must be a 65-byte ECDSA signature"),
})
export type TicketJson = z.infer<typeof TicketJson>

export const toTicketJson = (t: HandoverTicket): TicketJson => ({
  lotId: t.lotId.toString(),
  buyer: t.buyer,
  tokenAmount: t.tokenAmount.toString(),
  expiryBlock: t.expiryBlock.toString(),
  sig: t.sig,
})

export const fromTicketJson = (j: TicketJson): HandoverTicket => ({
  lotId: BigInt(j.lotId),
  buyer: j.buyer as Address,
  tokenAmount: BigInt(j.tokenAmount),
  expiryBlock: BigInt(j.expiryBlock),
  sig: j.sig as Hex,
})

export const encodeTicket = (t: HandoverTicket): string => JSON.stringify(toTicketJson(t))

export const NOT_A_TICKET = "This isn't a Fairtown handover code"

export function decodeTicket(text: string): HandoverTicket {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(NOT_A_TICKET)
  }
  const parsed = TicketJson.safeParse(raw)
  if (!parsed.success) throw new Error(NOT_A_TICKET, { cause: parsed.error })
  return fromTicketJson(parsed.data)
}
