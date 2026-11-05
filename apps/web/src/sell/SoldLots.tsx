import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { ShowCode } from "../handover/ShowCode"
import { STATUS_WORDS } from "../hud/model"
import { api } from "../net/api"
import { useTown } from "../state/townStore"
import { CameraCapture, type CapturedPhoto } from "./CameraCapture"
import { newLotCode } from "./model"

const NEEDS_SELLER = new Set(["sold", "truck_booked", "no_show_reported"])

/** "Buyer reported a no-show, respond in 2:00", with photo proof (POST /api/noshow/contest). */
function NoShowAnswer({ lot, sellerId }: { lot: LotState; sellerId: string }) {
  const block = useTown((s) => s.town.block)
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [lotCode] = useState(() => newLotCode())
  const send = useMutation({
    mutationFn: () => api.noshowContest({ body: { sellerId, lotId: lot.lotId, buyer: lot.noShowBuyer!, photos } }),
  })
  if (send.isSuccess) return <p role="status">Proof sent. It will be checked before any money moves.</p>
  return (
    <section aria-label="No-show reported" className="space-y-2 rounded bg-red-950 p-3">
      <p className="font-bold">
        The buyer says you didn't hand over. Answer in{" "}
        {lot.deadlineBlock !== undefined ? countdown(lot.deadlineBlock, block) : "—"}
      </p>
      <p className="text-sm">Take a photo that shows the goods were ready, with the code in frame.</p>
      <CameraCapture
        lotCode={lotCode}
        count={photos.length}
        max={3}
        onPhoto={(p) => setPhotos((prev) => [...prev, p].slice(0, 3))}
      />
      {send.isError && <p role="alert">We could not send your proof. Please try again.</p>}
      <button
        className="w-full rounded bg-amber-400 py-3 font-bold text-black disabled:opacity-50"
        disabled={photos.length === 0 || !lot.noShowBuyer || send.isPending}
        onClick={() => send.mutate()}
      >
        Send proof
      </button>
    </section>
  )
}

export function SoldLot({ lot, sellerId }: { lot: LotState; sellerId: string }) {
  const [showing, setShowing] = useState(false)
  return (
    <div className="space-y-2 rounded bg-slate-900 p-3">
      <p>
        Lot {lot.lotId} · {lot.qty} {lot.unit} {lot.commodity} · {STATUS_WORDS[lot.status] ?? lot.status}
      </p>
      {lot.status === "no_show_reported" ? (
        <NoShowAnswer lot={lot} sellerId={sellerId} />
      ) : showing ? (
        <ShowCode lot={lot} sellerId={sellerId} />
      ) : (
        <button className="w-full rounded bg-amber-400 py-3 font-bold text-black" onClick={() => setShowing(true)}>
          Show handover code
        </button>
      )}
    </div>
  )
}

/** The seller's lots that still need them: a handover code to show, or a no-show to answer. */
export function SoldLots({ sellerName, sellerId }: { sellerName: string; sellerId: string }) {
  const lots = useTown((s) => s.town.lots)
  const mine = Object.values(lots).filter(
    (l) => l.sellerName === sellerName && l.settlement && NEEDS_SELLER.has(l.status),
  )
  if (mine.length === 0) return null
  return (
    <section aria-label="Your sold lots" className="space-y-2">
      <h2 className="font-bold">Your sold lots</h2>
      {mine.map((l) => (
        <SoldLot key={l.lotId} lot={l} sellerId={sellerId} />
      ))}
    </section>
  )
}
