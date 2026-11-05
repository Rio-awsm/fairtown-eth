import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "../net/api"
import { CameraCapture, type CapturedPhoto } from "../sell/CameraCapture"
import { newLotCode } from "../sell/model"

/** Refuse the goods and open a dispute with photos (POST /api/disputes). The held money waits for the check. */
export function ReportProblem({
  buyerId,
  lotId,
  tokenAmount,
}: {
  buyerId: string
  lotId: string
  tokenAmount: string
}) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [lotCode] = useState(() => newLotCode())
  const send = useMutation({
    mutationFn: () => api.openDispute({ body: { buyerId, lotId, tokenAmount, photos } }),
  })
  if (send.isSuccess)
    return (
      <p role="status" className="rounded bg-slate-800 p-3">
        Report sent. The held money waits until the goods are checked.
      </p>
    )
  return (
    <section aria-label="Report a problem" className="space-y-2 rounded bg-slate-900 p-3">
      <h2 className="text-lg font-bold">Report a problem</h2>
      <CameraCapture
        lotCode={lotCode}
        count={photos.length}
        max={3}
        onPhoto={(p) => setPhotos((prev) => [...prev, p].slice(0, 3))}
      />
      {photos.length === 0 && <p className="text-sm text-slate-300">Take at least one photo of the problem.</p>}
      {send.isError && <p role="alert">We could not send the report. Please try again.</p>}
      <button
        className="w-full rounded bg-red-700 py-3 font-bold disabled:opacity-50"
        disabled={photos.length === 0 || send.isPending}
        onClick={() => send.mutate()}
      >
        Send report
      </button>
    </section>
  )
}
