type Timer = { at: number; fn: () => void; dead: boolean }
type Tween = { start: number; ms: number; update: (t: number) => void; done?: () => void; dead: boolean }

function safely(fn: () => void) {
  try {
    fn()
  } catch (error: unknown) {
    console.error("town clock callback failed", error)
  }
}

/**
 * The 3D town's own time: delayed calls and 0..1 tweens, advanced by the frame loop. A frame that
 * stops (a hidden tab) stops the town with it, as Phaser's clock did.
 */
export class Clock {
  now = 0
  private timers: Timer[] = []
  private tweens = new Set<Tween>()

  after(ms: number, fn: () => void): () => void {
    const timer: Timer = { at: this.now + Math.max(0, ms), fn, dead: false }
    this.timers.push(timer)
    return () => void (timer.dead = true)
  }

  /** Calls `update` with progress 0..1 each frame for `ms`, then `done`. Returns a stop. */
  tween(ms: number, update: (t: number) => void, done?: () => void): () => void {
    const tween: Tween = { start: this.now, ms: Math.max(0, ms), update, dead: false, ...(done ? { done } : {}) }
    this.tweens.add(tween)
    return () => {
      tween.dead = true
      this.tweens.delete(tween)
    }
  }

  advance(dtMs: number): void {
    this.now += dtMs
    const due = this.timers.filter((t) => !t.dead && t.at <= this.now).sort((a, b) => a.at - b.at)
    this.timers = this.timers.filter((t) => !t.dead && t.at > this.now)
    for (const t of due) safely(t.fn)
    for (const tw of [...this.tweens]) {
      if (tw.dead) continue
      const p = tw.ms === 0 ? 1 : Math.min(1, (this.now - tw.start) / tw.ms)
      safely(() => tw.update(p))
      if (p >= 1) {
        this.tweens.delete(tw)
        if (tw.done) safely(tw.done)
      }
    }
  }

  clear(): void {
    this.timers = []
    this.tweens.clear()
  }
}
