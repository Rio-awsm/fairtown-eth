/**
 * The landing hero as pure functions of scroll progress p (0..1). The page reads p from the scroll
 * position and paints whatever these return; nothing here touches the DOM.
 */

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
/** 0 before `from`, 1 after `to`, straight between. */
const ramp = (p: number, from: number, to: number) => clamp01((p - from) / (to - from))
/** Turn -0 into 0, so a resting hero compares equal to one that never moved. */
const z = (v: number) => (v === 0 ? 0 : v)

/** p = (scrollY − track.top) / (track.height − innerHeight), clamped to 0–1. */
export function progressOf(scrollY: number, track: { top: number; height: number }, innerHeight: number): number {
  const run = track.height - innerHeight
  if (run <= 0) return 0
  return clamp01((scrollY - track.top) / run)
}

export type HeroView = {
  /** y in vh, rotate in degrees about the bottom edge. */
  headline: { y: number; rotate: number; scale: number; opacity: number }
  /** y in px. */
  list: { y: number; opacity: number }
  /** line: how much of the underline is left. */
  cue: { opacity: number; line: number }
  /** The open deal step, 0 to 3. */
  step: number
}

export function heroAt(progress: number): HeroView {
  const p = clamp01(progress)
  const h = easeInOutQuad(ramp(p, 0, 0.38))
  const list = ramp(p, 0.08, 0.24)
  return {
    headline: { y: z(-34 * h), rotate: 62 * h, scale: 1 - 0.12 * h, opacity: 1 - ramp(p, 0.1, 0.24) },
    list: { y: 40 * (1 - list), opacity: list },
    cue: { opacity: 1 - ramp(p, 0.04, 0.12), line: 1 - ramp(p, 0, 0.1) },
    step: p < 0.4 ? 0 : p < 0.6 ? 1 : p < 0.8 ? 2 : 3,
  }
}

/** Target clip time: p × (duration − 1/48). 0 while the duration is unknown. */
export function clipTime(p: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return clamp01(p) * Math.max(0, duration - 1 / 48)
}

/** One frame of smoothing: cur += (target − cur) × .2, landing once within a hair. */
export function smooth(cur: number, target: number): number {
  const next = cur + (target - cur) * 0.2
  return Math.abs(target - next) < 1e-4 ? target : next
}

/** Recorder mode: hold 0.55 s, a linear glide of exactly 5.04 s, then hold, 6.5 s in all. */
export const REC = { hold: 0.55, glide: 5.04, total: 6.5 } as const

export function recProgress(t: number): number {
  return clamp01((t - REC.hold) / REC.glide)
}
