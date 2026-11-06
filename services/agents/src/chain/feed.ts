import type { ChainAdapter, ChainEvent } from "./types"

type Source = { watch(handler: (e: ChainEvent) => void, fromBlock?: bigint, onIdle?: (head: bigint) => void): () => void }

// One chain watcher for the whole service (the public RPC is rate limited), starting a lookback before the head so a
// restart rebuilds runtime, ledger, engine and market state. Late subscribers get the history replayed first.
export class ChainFeed {
  private readonly handlers = new Set<(e: ChainEvent) => void>()
  private readonly history: ChainEvent[] = []
  private stopSource?: () => void
  caughtUpTo?: bigint
  readonly fromBlock?: bigint
  events = 0

  constructor(
    private readonly src: Source,
    fromBlock?: bigint,
    private readonly maxHistory = 50_000,
  ) {
    if (fromBlock !== undefined) this.fromBlock = fromBlock
  }

  start() {
    this.stopSource = this.src.watch(
      (e) => {
        this.events++
        this.history.push(e)
        if (this.history.length > this.maxHistory) this.history.shift()
        for (const h of this.handlers) h(e)
      },
      this.fromBlock,
      (head) => (this.caughtUpTo = head),
    )
    return () => this.stopSource?.()
  }

  watch(handler: (e: ChainEvent) => void) {
    for (const e of this.history) handler(e)
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }
}

// The same adapter with watch() served by the feed.
export function withFeed<C extends ChainAdapter>(chain: C, feed: ChainFeed): C {
  return new Proxy(chain, {
    get(target, prop, recv) {
      if (prop === "watch") return (h: (e: ChainEvent) => void) => feed.watch(h)
      const v = Reflect.get(target, prop, recv)
      return typeof v === "function" ? v.bind(target) : v
    },
  })
}
