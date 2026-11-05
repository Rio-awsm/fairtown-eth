import { useState } from "react"
import { env } from "../config"
import { QrCode } from "../handover/QrCode"

/** Corner QR on /town and /board: judges scan it to join and bid (S3 3.2). */
type Props = { publicUrl?: string | undefined; shown?: boolean; onShownChange?: (shown: boolean) => void }

export function WalkinQr({ publicUrl = env.publicWebUrl, shown: controlled, onShownChange }: Props) {
  const [local, setLocal] = useState(true)
  const shown = controlled ?? local
  const setShown = (v: boolean) => (onShownChange ? onShownChange(v) : setLocal(v))
  const url = `${publicUrl ?? window.location.origin}/walkin`
  if (!shown)
    return (
      <button className="rounded bg-slate-900/85 px-2 py-1 text-xs" onClick={() => setShown(true)}>
        Show join QR
      </button>
    )
  return (
    <div className="w-44 space-y-1 rounded bg-slate-900/90 p-2 text-center text-sm">
      <QrCode text={url} label="Scan to join and bid" />
      <p className="font-bold">Scan to join and bid</p>
      {!publicUrl && env.exposeTown && (
        <p className="text-xs text-amber-300">Set PUBLIC_WEB_URL so phones can open this.</p>
      )}
      <button className="text-xs text-slate-300 underline" onClick={() => setShown(false)}>
        Hide
      </button>
    </div>
  )
}
