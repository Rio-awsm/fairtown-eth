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
  <section aria-label={label} className="ft-section">
    <h2 className="ft-section-title">{label}</h2>
    {children}
  </section>
)

export function LiveAuctions() {
  const lots = useTown((s) => s.town.lots)
  const block = useTown((s) => s.town.block)
  const open = Object.values(lots).filter((l) => l.status === "open" && l.endBlock > block)
  return (
    <Card label="Live auctions">
      {open.length === 0 && <p className="ft-empty">No auctions open right now.</p>}
      <ul className="ft-auctions">
        {open.map((l) => (
          <li key={l.lotId}>
            <span className="ft-auction-what">
              Lot {l.lotId} · {l.qty} {l.unit} {l.commodity} · {l.place}
            </span>
            <span className="ft-auction-now">
              {lotPerUnit(l, l.clearingPerUnit ?? l.floorPerUnit)} · {l.bids} bids · ends in{" "}
              {countdown(l.endBlock, block)}
            </span>
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
      <table aria-label="Latest clears" className="ft-table">
        <thead>
          <tr>
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
              <td>{r.tx.startsWith("0x") && r.tx.length === 66 ? <TxLink tx={r.tx} className="ft-tx" /> : "—"}</td>
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
      <table aria-label="Seller records" className="ft-table">
        <thead>
          <tr>
            <th>Seller</th>
            <th>Tier</th>
            <th>Clean lots</th>
            <th>No-shows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seller} className={r.noShows > 0n ? "ft-row-bad" : ""}>
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
      {weather.length === 0 && <p className="ft-empty">No clears in the last 30 days.</p>}
      <ul className="ft-weather">
        {weather.map((w) => (
          <li key={`${w.market}|${w.commodity}|${w.currency}`} data-band={w.band}>
            <span className="ft-weather-where">
              {BUILDING_SIGNS[w.market as Building] ?? w.market} · {w.commodity}
            </span>
            <span className="ft-weather-band">{BAND_WORDS[w.band]}</span>
            <span className="ft-weather-figures">
              {money(w.latest, w.currency)} vs 30-day {money(w.average, w.currency)}
            </span>
            <svg className="ft-weather-spark" viewBox="0 0 160 36" preserveAspectRatio="none" aria-hidden>
              <polyline
                points={sparkPoints(w.series, 160, 36)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
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
      <div className="ft-query-controls">
        <label>
          Commodity
          <select
            className="ft-select"
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
            className="ft-select"
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
          <button className="ft-chip-btn" onClick={() => setQuery(sellerRecord(noShowSeller))}>
            {sellerName(town, noShowSeller)}'s record
          </button>
        )}
      </div>
      {/* Focusable so keyboard users can scroll a long query (axe: scrollable-region-focusable). */}
      <pre tabIndex={0} aria-label="Query text" className="ft-code">
        {queryText(query)}
      </pre>
      {q.isError && <p role="alert">{UNREACHABLE}</p>}
      <div className="ft-table-scroll" tabIndex={0} role="region" aria-label="Query results, scrollable">
        <table aria-label="Query results" className="ft-table ft-table-raw">
          <thead>
            <tr>
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
      </div>
      <p className="ft-footnote">Raw values as stored: money in base units (6 decimals), days since 1970.</p>
    </Card>
  )
}
