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
      <button className="rpg-btn rpg-btn-quiet rpg-btn-sm" onClick={() => setShown(true)}>
        Show join QR
      </button>
    )
  return (
    <div className="rpg-window w-44 space-y-1 p-3 text-center text-sm">
      <QrCode text={url} label="Scan to join and bid" />
      <p className="font-bold">Scan to join and bid</p>
      {!publicUrl && env.exposeTown && (
        <p className="text-xs text-gold-ink">Set PUBLIC_WEB_URL so phones can open this.</p>
      )}
      <button className="text-xs text-ink-soft underline" onClick={() => setShown(false)}>
        Hide
      </button>
    </div>
  )
}
