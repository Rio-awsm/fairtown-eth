import type { HandoverTicket } from "@fairtown/shared"
import type { Address } from "viem"
import type { ChainAdapter } from "../chain/types"

export const TICKET_VALID_BLOCKS = 300n // about 1 minute at 200 ms blocks

// The only place seller keys sign handover tickets (stream rule). Never log the returned signature with private data.
export async function issueTicket(
  chain: Pick<ChainAdapter, "signTicket" | "blockNumber">,
  seller: Address,
  t: { lotId: bigint; buyer: Address; tokenAmount: bigint },
  validBlocks = TICKET_VALID_BLOCKS,
): Promise<HandoverTicket> {
  const expiryBlock = (await chain.blockNumber()) + validBlocks
  return chain.signTicket(seller, { lotId: t.lotId, buyer: t.buyer, tokenAmount: t.tokenAmount, expiryBlock })
}
