// Minimal types for the `qrcode` package (MIT): only what src/qr.ts uses.
declare module "qrcode" {
  export function toBuffer(text: string, options?: { type?: "png"; errorCorrectionLevel?: "L" | "M" | "Q" | "H"; margin?: number; scale?: number }): Promise<Buffer>
}
