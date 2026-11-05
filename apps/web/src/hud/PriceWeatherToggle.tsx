import { useEffect } from "react"
import { ledger as defaultLedger } from "../arkiv/client"
import type { LedgerClient } from "../arkiv/ledger"
import type { PriceRow } from "../arkiv/mockLedger"
import { allClears } from "../arkiv/queries"
import { useLedgerQuery } from "../arkiv/useLedgerQuery"
import { BAND_COLOUR, BAND_WORDS, marketWeather, type Band } from "../arkiv/weather"
import { EventBus } from "../game/EventBus"
import { useTown } from "../state/townStore"

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`

/** Town toggle: tints each building by its price against its own 30-day average (S3 4.1). */
export function PriceWeatherToggle({ client = defaultLedger }: { client?: LedgerClient }) {
  const on = useTown((s) => s.ui.priceWeather)
  const setUi = useTown((s) => s.setUi)
  const q = useLedgerQuery(client, allClears(100))
  const rows = (q.data ?? []) as PriceRow[]
  useEffect(() => {
    if (!on) return EventBus.emit("priceWeather", null)
    const today = rows.reduce((max, r) => (r.day > max ? r.day : max), 0n)
    const byMarket: Record<string, Band> = {}
    // A building follows its most recent commodity.
    const newestFirst = marketWeather(rows, today).sort((a, b) =>
      b.newest.day !== a.newest.day ? (b.newest.day > a.newest.day ? 1 : -1) : b.newest.lotId > a.newest.lotId ? 1 : -1,
    )
    for (const w of newestFirst) byMarket[w.market] ??= w.band
    EventBus.emit("priceWeather", byMarket)
  }, [on, rows])
  return (
    <div className="space-y-1">
      <button
        aria-pressed={on}
        className={`rounded px-3 py-1 text-sm ${on ? "bg-sky-700" : "bg-slate-900/85"}`}
        onClick={() => setUi({ priceWeather: !on })}
      >
        Price weather
      </button>
      {on && (
        <ul aria-label="Price weather legend" className="rounded bg-slate-900/85 p-2 text-xs">
          {(Object.keys(BAND_WORDS) as Band[]).map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded" style={{ background: hex(BAND_COLOUR[b]) }} />
              {BAND_WORDS[b]}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
