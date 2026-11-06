import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import type { LotState } from "../game/reducer"
import { handoverParties, type HandoverParty } from "../handover/model"
import { api } from "../net/api"

const Winners = z.array(z.object({ buyer: z.string(), tokenAmount: z.string().regex(/^\d+$/) }))

/** The lot's winners (D-108): from the API, else the single-bidder rule. Undefined while the API answers. */
export function useWinners(lot: LotState): HandoverParty[] | undefined {
  const view = useQuery({ queryKey: ["lot", lot.lotId], queryFn: () => api.lot({ params: { lotId: lot.lotId } }) })
  if (view.isPending) return undefined
  const winners = Winners.safeParse((view.data as { winners?: unknown } | undefined)?.winners).data
  return handoverParties(lot, winners)
}
