/** Demo mode (`?demo=1`, S3 5.1) makes town text bigger for a projector. Set once when the scene starts. */
let scale = 1
export const setTextScale = (s: number) => {
  scale = s
}
export const fs = (px: number) => `${Math.round(px * scale * 10) / 10}px`
