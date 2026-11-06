// The handover QR as a PNG, for the web scan page and phone cameras. Loaded lazily so the bot still starts (codes and
// links keep working) if the package is missing.
export async function renderQr(text: string): Promise<Buffer> {
  const qrcode = await import("qrcode")
  return qrcode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 8 })
}
