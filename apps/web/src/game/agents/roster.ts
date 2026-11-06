/** Sprite pool bookkeeping: at most `max` agents on screen (S3 1.2 pooling to 80). Humans are never recycled. */
export class AgentRoster {
  /** Insertion order is recency: oldest first. */
  private readonly agents = new Map<string, { slot: number; human: boolean }>()
  private readonly free: number[]

  constructor(private readonly max = 80) {
    this.free = Array.from({ length: max }, (_, i) => i)
  }

  get size(): number {
    return this.agents.size
  }

  slotOf(agentId: string): number | undefined {
    return this.agents.get(agentId)?.slot
  }

  touch(agentId: string): void {
    const entry = this.agents.get(agentId)
    if (!entry) return
    this.agents.delete(agentId)
    this.agents.set(agentId, entry)
  }

  /** A slot for the agent, recycling the least recently active non-human when full. Null if only humans remain. */
  admit(agentId: string, opts: { human: boolean }): { slot: number; evicted?: string } | null {
    const existing = this.agents.get(agentId)
    if (existing) {
      this.touch(agentId)
      return { slot: existing.slot }
    }
    if (this.free.length > 0) {
      this.free.sort((a, b) => a - b)
      const slot = this.free.shift()!
      this.agents.set(agentId, { slot, human: opts.human })
      return { slot }
    }
    const victim = [...this.agents.entries()].find(([, e]) => !e.human)
    if (!victim) return null
    const [evicted, { slot }] = victim
    this.agents.delete(evicted)
    this.agents.set(agentId, { slot, human: opts.human })
    return { slot, evicted }
  }

  remove(agentId: string): void {
    const entry = this.agents.get(agentId)
    if (!entry) return
    this.agents.delete(agentId)
    this.free.push(entry.slot)
  }
}
