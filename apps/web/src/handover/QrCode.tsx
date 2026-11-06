import QRCode from "qrcode"
import { useEffect, useState } from "react"

/** Draws a QR as SVG (no canvas needed). `data-qr` carries the exact text for tests. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 })
      .then((svg) => live && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch((error: unknown) => console.error("could not draw the handover code", error))
    return () => {
      live = false
    }
  }, [text])
  if (!src) return <p>Drawing the code…</p>
  return <img src={src} alt={label} data-qr={text} className="rpg-well mx-auto w-full max-w-80 bg-white p-2" />
}
