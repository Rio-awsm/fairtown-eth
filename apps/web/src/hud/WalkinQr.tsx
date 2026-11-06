import { useState } from "react"
import { env } from "../config"
import { QrCode } from "../handover/QrCode"

/** Corner QR on /town and /board: judges scan it to join and bid (S3 3.2). */
type Props = {
  publicUrl?: string | undefined
  shown?: boolean
  onShownChange?: (shown: boolean) => void
  /** "night": the landing's look (the public board); the default is the town's pixel look. */
  look?: "pixel" | "night"
}

export function WalkinQr({ publicUrl = env.publicWebUrl, shown: controlled, onShownChange, look = "pixel" }: Props) {
  const night = look === "night"
  const [local, setLocal] = useState(true)
  const shown = controlled ?? local
  const setShown = (v: boolean) => (onShownChange ? onShownChange(v) : setLocal(v))
  const url = `${publicUrl ?? window.location.origin}/walkin`
  if (!shown)
    return (
      <button className={night ? "ft-chip-btn" : "rpg-btn rpg-btn-quiet rpg-btn-sm"} onClick={() => setShown(true)}>
        Show join QR
      </button>
    )
  return (
    <div className={night ? "ft-qr" : "rpg-window w-44 space-y-1 p-3 text-center text-sm"}>
      <QrCode text={url} label="Scan to join and bid" />
      <p className={night ? "ft-qr-title" : "font-bold"}>Scan to join and bid</p>
      {!publicUrl && env.exposeTown && (
        <p className={night ? "ft-qr-warn" : "text-xs text-gold-ink"}>Set PUBLIC_WEB_URL so phones can open this.</p>
      )}
      <button className={night ? "ft-qr-hide" : "text-xs text-ink-soft underline"} onClick={() => setShown(false)}>
        Hide
      </button>
    </div>
  )
}
