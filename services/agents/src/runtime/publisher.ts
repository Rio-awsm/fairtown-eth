import type { TownEnvelope, TownEvent } from "@fairtown/shared"
import { randomUUID } from "node:crypto"

export interface Publisher {
  publish(events: TownEvent[], block?: number): Promise<void>
}

const envelope = (event: TownEvent, block?: number): TownEnvelope => ({
  v: 1,
  id: `agents-${randomUUID()}`,
  ts: Date.now(),
  ...(block !== undefined ? { block } : {}),
  source: "agents",
  event,
})

// Contract 12.4: agents publish agent.*, human.joined and clock phases to the relay.
export class RelayPublisher implements Publisher {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly onError: (e: unknown) => void = () => {},
  ) {}
  async publish(events: TownEvent[], block?: number) {
    try {
      const res = await fetch(`${this.url.replace(/\/+$/, "")}/internal/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify(events.map((e) => envelope(e, block))),
        signal: AbortSignal.timeout(2000),
      })
      if (!res.ok) this.onError(new Error(`relay returned HTTP ${res.status}`))
    } catch (e) {
      // The town is a window; a dropped intent never blocks a bid.
      this.onError(e)
    }
  }
}

// CHAIN_MODE=fake only: forward FakeChain logs to the relay, which maps them to town events (it stays their only producer).
export class ChainBridge {
  private queue: Promise<void> = Promise.resolve()
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly onError: (e: unknown) => void = () => {},
  ) {}
  forward(event: unknown) {
    const body = JSON.stringify([event], (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    this.queue = this.queue.then(async () => {
      try {
        const res = await fetch(`${this.url.replace(/\/+$/, "")}/internal/chain`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
          body,
          signal: AbortSignal.timeout(2000),
        })
        if (!res.ok) this.onError(new Error(`relay bridge HTTP ${res.status}`))
      } catch (e) {
        this.onError(e)
      }
    })
  }
}

export class MemoryPublisher implements Publisher {
  readonly sent: TownEnvelope[] = []
  async publish(events: TownEvent[], block?: number) {
    this.sent.push(...events.map((e) => envelope(e, block)))
  }
}
