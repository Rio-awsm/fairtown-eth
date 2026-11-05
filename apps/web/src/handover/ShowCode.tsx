import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { z } from "zod"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { nameOf } from "../hud/model"
import { api } from "../net/api"
import { useTown } from "../state/townStore"
import { handoverParties, type HandoverParty } from "./model"
import { QrCode } from "./QrCode"

const Winners = z.array(
  z.object({ buyer: z.string().regex(/^0x[0-9a-fA-F]{40}$/), tokenAmount: z.string().regex(/^\d+$/) }),
)

/** The seller's (or truck's) handover code for one buyer: big QR, expiry, and a link for phones without a camera. */
export function ShowCode({ lot, sellerId }: { lot: LotState; sellerId: string }) {
  const town = useTown((s) => s.town)
  const view = useQuery({ queryKey: ["lot", lot.lotId], queryFn: () => api.lot({ params: { lotId: lot.lotId } }) })
  const winners = Winners.safeParse((view.data as { winners?: unknown } | undefined)?.winners).data
  // Wait for the API: deciding the buyer before `winners` arrive could make a code for the wrong person.
  const parties = view.isPending ? [] : handoverParties(lot, winners)
  const [chosen, setChosen] = useState<HandoverParty | null>(null)
  const party = chosen ?? (parties.length === 1 ? parties[0]! : null)
  const ticket = useMutation({
    mutationFn: (p: HandoverParty) =>
      api.handoverTicket({ body: { sellerId, lotId: lot.lotId, buyer: p.buyer, tokenAmount: p.tokenAmount } }),
  })
  const { mutate, isIdle } = ticket
  useEffect(() => {
    if (party && isIdle) mutate(party)
  }, [party, isIdle, mutate])

  if (view.isPending) return <p>Finding the buyer…</p>
  if (parties.length === 0)
    return (
      <p role="alert">
        {lot.bidLog.length > 1
          ? "Several buyers won this lot. Ask the market desk which code to show."
          : "Nobody to hand over to yet."}
      </p>
    )
  if (!party)
    return (
      <div className="space-y-2">
        <p>Who is collecting?</p>
        {parties.map((p) => (
          <button key={p.buyer} className="w-full rounded bg-slate-700 py-3" onClick={() => setChosen(p)}>
            {nameOf(town, p.buyer)}
          </button>
        ))}
      </div>
    )
  if (ticket.isError)
    return (
      <div role="alert" className="space-y-2">
        <p>We could not make a code just now.</p>
        <button className="rounded bg-slate-700 px-4 py-2" onClick={() => mutate(party)}>
          Try again
        </button>
      </div>
    )
  if (!ticket.data) return <p>Making your code…</p>

  const expired = BigInt(ticket.data.ticket.expiryBlock) <= BigInt(town.block)
  if (expired)
    return (
      <div className="space-y-2">
        <p role="alert">This code has expired.</p>
        <button className="w-full rounded bg-amber-400 py-3 font-bold text-black" onClick={() => mutate(party)}>
          New code
        </button>
      </div>
    )
  const fallback = new URL(ticket.data.fallbackUrl, window.location.origin).toString()
  return (
    <div className="space-y-2 text-center">
      <QrCode text={ticket.data.qrText} label={`Handover code for Lot ${lot.lotId}`} />
      <p className="text-amber-300">Expires in {countdown(Number(ticket.data.ticket.expiryBlock), town.block)}</p>
      <p className="text-sm">Show this to {nameOf(town, party.buyer)} or their truck. It works once.</p>
      <a className="text-sky-300 underline" href={fallback}>
        Open without the camera
      </a>
    </div>
  )
}
