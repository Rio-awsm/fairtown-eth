import { ledger as defaultLedger } from "../arkiv/client"
import type { LedgerClient } from "../arkiv/ledger"
import "../board/board.css"
import { LatestClears, LiveAuctions, PriceWeather, QueryBox, SellerRecords } from "../board/sections"
import { WalkinQr } from "../hud/WalkinQr"

/** Public board (S3 4.1): the public record on Arkiv, visible and queryable live. */
export function BoardPage({ client = defaultLedger }: { client?: LedgerClient }) {
  const live = client.mode === "live"
  return (
    <div className="ft-board">
      <header className="ft-board-head">
        <div>
          <h1 className="ft-board-title">Public board</h1>
          <p className="ft-board-lede">
            Every cleared price and every seller&apos;s record, as written to the public ledger. Read it here, or query
            it yourself.
          </p>
          <span className={`ft-ledger ${live ? "ft-ledger-live" : ""}`}>
            {live ? "LIVE LEDGER · Arkiv Rabdi" : "MOCK LEDGER"}
          </span>
        </div>
        <WalkinQr look="night" />
      </header>
      <div className="ft-board-grid">
        <div className="ft-board-main">
          <PriceWeather client={client} />
          <QueryBox client={client} />
        </div>
        <aside className="ft-board-rail" aria-label="Market activity">
          <LiveAuctions />
          <LatestClears client={client} />
          <SellerRecords client={client} />
        </aside>
      </div>
    </div>
  )
}
