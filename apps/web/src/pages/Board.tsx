import { ledger as defaultLedger } from "../arkiv/client"
import type { LedgerClient } from "../arkiv/ledger"
import { LatestClears, LiveAuctions, PriceWeather, QueryBox, SellerRecords } from "../board/sections"
import { WalkinQr } from "../hud/WalkinQr"

/** Public board (S3 4.1): the public record on Arkiv, visible and queryable live. */
export function BoardPage({ client = defaultLedger }: { client?: LedgerClient }) {
  return (
    <section className="mx-auto max-w-[1880px] space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h1 className="rpg-banner">Public board</h1>
        <span
          className={`rpg-badge ${client.mode === "live" ? "bg-harbour text-parchment-light" : "bg-coin text-ink"}`}
        >
          {client.mode === "live" ? "LIVE LEDGER · Arkiv Rabdi" : "MOCK LEDGER"}
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)_14rem]">
        <div className="space-y-3">
          <LiveAuctions />
          <LatestClears client={client} />
          <SellerRecords client={client} />
        </div>
        <div className="space-y-3">
          <PriceWeather client={client} />
          <QueryBox client={client} />
        </div>
        <div>
          <WalkinQr />
        </div>
      </div>
    </section>
  )
}
