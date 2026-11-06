import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import QRCode from "qrcode"

/**
 * Writes a Y4M video that shows one QR code, for Chromium's fake camera
 * (`--use-file-for-fake-video-capture`). Greyscale: Y carries the code, U and V stay neutral.
 */
export function writeQrVideo(text: string, path: string, width = 640, height = 480): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" })
  const size = qr.modules.size
  const quiet = 4
  const scale = Math.floor(Math.min(width, height) / (size + quiet * 2))
  const x0 = Math.floor((width - size * scale) / 2)
  const y0 = Math.floor((height - size * scale) / 2)
  const luma = Buffer.alloc(width * height, 255)
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      if (!qr.modules.get(r, c)) continue
      for (let dy = 0; dy < scale; dy++)
        luma.fill(
          0,
          (y0 + r * scale + dy) * width + x0 + c * scale,
          (y0 + r * scale + dy) * width + x0 + (c + 1) * scale,
        )
    }
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128)
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma, chroma])
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.concat([header, ...Array.from({ length: 10 }, () => frame)]))
}
