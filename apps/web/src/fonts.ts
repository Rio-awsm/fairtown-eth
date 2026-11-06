/** Families the town canvas draws with; Phaser text made before these load keeps the fallback face. */
export const TOWN_FONTS = ['400 16px "Jersey 10"', '400 16px "Atkinson Hyperlegible"']

type FontDoc = { fonts?: { load(font: string): Promise<unknown> } }

/** Waits for the town fonts, but never longer than `timeoutMs`: a missing font must not stop the demo. */
export async function loadFonts(doc: FontDoc, timeoutMs = 2000): Promise<"loaded" | "timeout" | "failed"> {
  if (!doc.fonts) return "failed"
  const all = Promise.all(TOWN_FONTS.map((f) => doc.fonts!.load(f))).then(
    () => "loaded" as const,
    (error: unknown) => {
      console.warn("town fonts failed to load, using the fallback face", error)
      return "failed" as const
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      console.warn(`town fonts not ready after ${timeoutMs} ms, using the fallback face`)
      resolve("timeout")
    }, timeoutMs)
  })
  const result = await Promise.race([all, late])
  clearTimeout(timer)
  return result
}
