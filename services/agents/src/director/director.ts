import type { ChainAdapter, SignalInput } from "../chain/types"
import type { FakeChain } from "../chain/fake/FakeChain"
import type { SectorEngine } from "../sectors/engine"
import { stepsFor, type ScenarioName } from "./scenes"

export type SignalSink = { push(s: SignalInput): Promise<void> }

// FakeChain: push straight into the oracle stand-in.
export const fakeSignals = (chain: Pick<FakeChain, "pushSignal">): SignalSink => ({ push: async (s) => chain.pushSignal(s) })

// Real chain: ask S1's CRE bridge (S1 4.5) to run W2 with forced signals. Body shape is our proposal until the bridge exists.
export const creBridgeSignals = (url: string, token: string, f: typeof fetch = fetch): SignalSink => ({
  push: async (s) => {
    const res = await f(`${url.replace(/\/+$/, "")}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ workflow: "w2-signals", forceSignals: [{ ...s, expiresAtBlock: s.expiresAtBlock.toString() }] }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`CRE bridge HTTP ${res.status}`)
  },
})

type Run = { name: ScenarioName; startBlock: bigint; speed: number; pending: Array<{ at: bigint; label: string; scene: string; run: () => Promise<unknown> }>; done: string[] }
export type Festival = { name: string; date: string; market: string }

export const MAX_RUNNING = 3

// Runs scenes as block-offset scripts on top of the sector engine; the engine then plays out the trust chain.
export class Director {
  private readonly runs: Run[] = []
  readonly log: Array<{ block: string; scenario: string; step: string; ok: boolean; error?: string }> = []
  private last: { scenario: string; step: string } | null = null
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly o: {
      chain: Pick<ChainAdapter, "blockNumber">
      engine: SectorEngine
      signals: SignalSink
      signalBlocks?: bigint // how long a director signal lasts
      festivals?: Festival[]
      today?: () => Date
    },
  ) {}

  async start(name: ScenarioName, speed = 1): Promise<{ started: boolean; reason?: string }> {
    if (this.runs.some((r) => r.name === name)) return { started: false, reason: `${name} is already running` }
    if (this.runs.length >= MAX_RUNNING) return { started: false, reason: `At most ${MAX_RUNNING} scenarios at once` }
    const block = await this.o.chain.blockNumber()
    const ctx = {
      engine: this.o.engine,
      signal: (s: Omit<SignalInput, "expiresAtBlock">) => this.o.signals.push({ ...s, expiresAtBlock: block + (this.o.signalBlocks ?? 3000n) }),
      calendarLabel: (n: string, m: string) => this.calendarLabel(n, m),
    }
    const pending = stepsFor(name).map((s) => ({ at: block + BigInt(Math.floor(s.at / speed)), label: s.label, scene: s.scene, run: () => s.run(ctx) }))
    this.runs.push({ name, startBlock: block, speed, pending, done: [] })
    await this.step()
    return { started: true }
  }

  async step() {
    const block = await this.o.chain.blockNumber()
    for (const r of [...this.runs]) {
      const due = r.pending.filter((p) => p.at <= block)
      r.pending = r.pending.filter((p) => p.at > block)
      for (const p of due) {
        this.last = { scenario: r.name, step: p.label }
        try {
          await p.run()
          this.log.push({ block: block.toString(), scenario: r.name, step: p.label, ok: true })
        } catch (e) {
          this.log.push({ block: block.toString(), scenario: r.name, step: p.label, ok: false, error: e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 200) : String(e) })
        }
        r.done.push(p.label)
      }
      if (!r.pending.length) this.runs.splice(this.runs.indexOf(r), 1)
    }
  }

  status() {
    return {
      scenario: this.last?.scenario ?? null,
      step: this.last?.step ?? null,
      running: this.runs.map((r) => ({ name: r.name, speed: r.speed, startBlock: r.startBlock.toString(), done: r.done, next: r.pending[0]?.label ?? null })),
      log: this.log.slice(-20),
    }
  }

  begin(tickMs = 1000) {
    this.timer = setInterval(() => void this.step(), tickMs)
    this.timer.unref?.()
    return () => this.timer && clearInterval(this.timer)
  }

  // "Diwali in 2 days" when the calendar says so; "(forced)" when the date is not near.
  calendarLabel(name: string, market: string) {
    const today = this.o.today?.() ?? new Date()
    const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    const next = (this.o.festivals ?? [])
      .filter((f) => f.market === market && f.name.startsWith(name))
      .map((f) => Math.round((Date.parse(`${f.date}T00:00:00Z`) - t0) / 86_400_000))
      .filter((d) => d >= 0)
      .sort((a, b) => a - b)[0]
    if (next === undefined || next > 7) return `${name} soon (forced)`
    return next === 0 ? `${name} today` : `${name} in ${next} day${next === 1 ? "" : "s"}`
  }
}
