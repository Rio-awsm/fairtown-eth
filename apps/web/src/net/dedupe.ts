/** Remembers the last `max` envelope ids. The relay de-duplicates by id (contract 12.3); so do we. */
export class Deduper {
  private readonly ids = new Set<string>()

  constructor(private readonly max = 5000) {}

  /** True if the id was already seen; otherwise records it and returns false. */
  seen(id: string): boolean {
    if (this.ids.has(id)) return true
    this.ids.add(id)
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value
      if (oldest !== undefined) this.ids.delete(oldest)
    }
    return false
  }
}
