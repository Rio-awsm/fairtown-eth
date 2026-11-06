import type { Building, Currency } from "@fairtown/shared/keys"
import { useState } from "react"
import type { LedgerClient } from "../arkiv/ledger"
import type { PriceRow, ReputationRow } from "../arkiv/mockLedger"
import {
  allClears,
  allReputations,
  clearsFor,
  latestReputations,
  queryText,
  sellerRecord,
  type LedgerQuery,
} from "../arkiv/queries"
import { useLedgerQuery } from "../arkiv/useLedgerQuery"
import { BAND_WORDS, marketWeather, sparkPoints } from "../arkiv/weather"
import { countdown } from "../game/market/slots"
import type { TownState } from "../game/reducer"
import { BUILDING_SIGNS } from "../game/map/buildings"
import { TxLink } from "../hud/links"
import { asCurrency, lotPerUnit, shortAddress } from "../hud/model"
import { formatMoney } from "../money/format"
import { useTown } from "../state/townStore"

const UNREACHABLE = "We could not reach the ledger just now. Retrying."
const money = (base: bigint, currency: string) => {
  const c = asCurrency(currency)
  return c ? formatMoney(base, c as Currency) : base.toString()
}
export const sellerName = (town: TownState, address: string) =>
  Object.values(town.lots).find((l) => l.seller.toLowerCase() === address.toLowerCase())?.sellerName ??
  town.agents[address]?.name ??
  shortAddress(address)
const Card = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section aria-label={label} className="rpg-window space-y-2 p-4">
    <h2 className="text-lg font-bold">{label}</h2>
    {children}
  </section>
)

export function LiveAuctions() {
  const lots = useTown((s) => s.town.lots)
  const block = useTown((s) => s.town.block)
  const open = Object.values(lots).filter((l) => l.status === "open" && l.endBlock > block)
  return (
    <Card label="Live auctions">
      {open.length === 0 && <p className="text-ink-soft">No auctions open right now.</p>}
      <ul className="space-y-1">
        {open.map((l) => (
          <li key={l.lotId}>
            Lot {l.lotId} · {l.qty} {l.unit} {l.commodity} · {l.place} ·{" "}
            {lotPerUnit(l, l.clearingPerUnit ?? l.floorPerUnit)} · {l.bids} bids · ends in{" "}
            {countdown(l.endBlock, block)}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function LatestClears({ client }: { client: LedgerClient }) {
  const q = useLedgerQuery(client, allClears(10))
  const rows = (q.data ?? []) as PriceRow[]
  return (
    <Card label="Latest clears">
      {q.isError && <p role="alert">{UNREACHABLE}</p>}
      <table aria-label="Latest clears" className="w-full text-sm [&_td]:py-1 [&_td]:pr-3 [&_th]:pr-3">
        <thead>
          <tr className="text-left text-ink-soft">
            <th>Lot</th>
            <th>What</th>
            <th>Final</th>
            <th>Average paid</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.$key}>
              <td>Lot {r.lotId.toString()}</td>
              <td>
                {r.commodity} · {r.place}
              </td>
              <td title="price.finalClearingPerUnit">{money(r.finalClearingPerUnit, r.currency)}</td>
              <td title="price.avgPerUnit">{money(r.avgPerUnit, r.currency)}</td>
              <td>{r.tx.startsWith("0x") && r.tx.length === 66 ? <TxLink tx={r.tx} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export function SellerRecords({ client }: { client: LedgerClient }) {
  const town = useTown((s) => s.town)
  const q = useLedgerQuery(client, allReputations())
  const rows = latestReputations((q.data ?? []) as ReputationRow[])
  return (
    <Card label="Seller records">
      {q.isError && <p role="alert">{UNREACHABLE}</p>}
      <table aria-label="Seller records" className="w-full text-sm [&_td]:py-1 [&_td]:pr-3 [&_th]:pr-3">
        <thead>
          <tr className="text-left text-ink-soft">
            <th>Seller</th>
            <th>Tier</th>
            <th>Clean lots</th>
            <th>No-shows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seller} className={r.noShows > 0n ? "text-brick" : ""}>
              <td>{sellerName(town, r.seller)}</td>
              <td>{r.tier === "proven" ? "Proven" : "New"}</td>
              <td>{r.cleanLots.toString()}</td>
              <td>{r.noShows.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export function PriceWeather({ client }: { client: LedgerClient }) {
  const q = useLedgerQuery(client, allClears(100))
  const rows = (q.data ?? []) as PriceRow[]
  const today = rows.reduce((max, r) => (r.day > max ? r.day : max), 0n)
  const weather = marketWeather(rows, today)
  return (
    <Card label="Price weather">
      {q.isError && <p role="alert">{UNREACHABLE}</p>}
      {weather.length === 0 && <p className="text-ink-soft">No clears in the last 30 days.</p>}
      <ul className="space-y-2">
        {weather.map((w) => (
          <li key={`${w.market}|${w.commodity}|${w.currency}`} className="flex items-center gap-3">
            <span className="w-80">
              {BUILDING_SIGNS[w.market as Building] ?? w.market} · {w.commodity}
            </span>
            <span className="w-48 text-sm">{BAND_WORDS[w.band]}</span>
            <span className="text-sm text-ink-soft">
              {money(w.latest, w.currency)} vs 30-day {money(w.average, w.currency)}
            </span>
            <svg width="100" height="20" aria-hidden className="text-moss-ink">
              <polyline points={sparkPoints(w.series, 100, 20)} fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const COMMODITY_CHOICES = ["cod", "haddock", "tomato", "marigold", "rose", "truck_capacity", "gpu_hour"]

/** "Query the ledger": real SDK query text and the live results for it (never canned). */
export function QueryBox({ client }: { client: LedgerClient }) {
  const town = useTown((s) => s.town)
  const reps = useTown((s) => s.ledger.reputation)
  const [query, setQuery] = useState<LedgerQuery>(() => clearsFor({ commodity: "cod" }))
  const [commodity, setCommodity] = useState("cod")
  const [place, setPlace] = useState("")
  const q = useLedgerQuery(client, query)
  const rows = q.data ?? []
  const columns = rows[0] ? Object.keys(rows[0]).filter((k) => k !== "$key") : []
  const noShowSeller = latestReputations(reps).find((r) => r.noShows > 0n)?.seller
  const rebuild = (c: string, p: string) =>
    setQuery(clearsFor({ ...(c ? { commodity: c } : {}), ...(p ? { place: p } : {}) }))
  return (
    <Card label="Query the ledger">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          Commodity
          <select
            className="rpg-input ml-2 min-h-0 p-1"
            value={commodity}
            onChange={(e) => {
              setCommodity(e.target.value)
              rebuild(e.target.value, place)
            }}
          >
            <option value="">Any</option>
            {COMMODITY_CHOICES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Place
          <select
            className="rpg-input ml-2 min-h-0 p-1"
            value={place}
            onChange={(e) => {
              setPlace(e.target.value)
              rebuild(commodity, e.target.value)
            }}
          >
            <option value="">Any</option>
            {["bergen", "dallas", "pune", "lagos", "any_dc"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {noShowSeller && (
          <button className="rpg-btn rpg-btn-quiet rpg-btn-sm" onClick={() => setQuery(sellerRecord(noShowSeller))}>
            {sellerName(town, noShowSeller)}'s record
          </button>
        )}
      </div>
      {/* Focusable so keyboard users can scroll a long query (axe: scrollable-region-focusable). */}
      <pre
        tabIndex={0}
        aria-label="Query text"
        className="rpg-well overflow-x-auto bg-ink p-3 text-xs text-meadow-tint"
      >
        {queryText(query)}
      </pre>
      {q.isError && <p role="alert">{UNREACHABLE}</p>}
      <table aria-label="Query results" className="w-full font-mono text-xs [&_td]:pr-4 [&_th]:pr-4">
        <thead>
          <tr className="text-left text-ink-soft">
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.$key ?? i)}>
              {columns.map((c) => (
                <td key={c}>{String(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-soft">Raw values as stored: money in base units (6 decimals), days since 1970.</p>
    </Card>
  )
}
