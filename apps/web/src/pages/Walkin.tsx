import { toQ96 } from "@fairtown/shared/units"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useWinners } from "../buy/useWinners"
import { countdown } from "../game/market/slots"
import type { LotState } from "../game/reducer"
import { asCurrency, lotMoney, lotPerUnit } from "../hud/model"
import { TestMoneyBadge } from "../hud/ModeBadge"
import { api } from "../net/api"
import { ApiClientError } from "../net/apiClient"
import { useTown } from "../state/townStore"
import { DEFAULT_BUDGET, SLIDER_STEPS, apiMaxPerUnit, checkAmount, maxUnits, priceAt, tickPlan } from "../walkin/model"
import { clearSession, loadSession, saveSession, type WalkinSession } from "../walkin/session"
import type { PersonLook } from "../game/art/people"
import { PixelPerson } from "../hud/PixelPerson"
import { unitLabel } from "../money/format"

const AVATARS = [
  { id: "chef", label: "Chef", look: { role: "STORAGE", skin: 1, hair: 0, style: "cap" } },
  { id: "farmer", label: "Farmer", look: { role: "SELLER", skin: 3, hair: 2, style: "short" } },
  { id: "trader", label: "Trader", look: { role: "BUYER", skin: 2, hair: 5, style: "bun" } },
  { id: "visitor", label: "Visitor", look: { role: "HUMAN", skin: 0, hair: 3, style: "long" } },
] as const satisfies readonly { id: string; label: string; look: PersonLook }[]
const NAME_MAX = 32
type Placed = { lotId: string; q: bigint; amount: bigint }
const offline = (e: unknown) => e instanceof ApiClientError && e.code === "network"

function Join({ onJoined }: { onJoined(s: WalkinSession): void }) {
  const [name, setName] = useState("")
  const [avatar, setAvatar] = useState("visitor")
  const trimmed = name.trim()
  const tooLong = trimmed.length > NAME_MAX
  const join = useMutation({
    mutationFn: () => api.walkin({ body: { name: trimmed } }),
    onSuccess: (res) => {
      const budget = (res as { budget?: unknown }).budget
      onJoined({
        ...res,
        name: trimmed,
        avatar,
        ...(typeof budget === "string" && /^\d+$/.test(budget) ? { budget } : {}),
      })
    },
  })
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block">Your name</span>
        <input className="rpg-input mt-2 w-full text-lg" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {tooLong && <p className="text-sm text-gold-ink">Use 32 letters or fewer</p>}
      <fieldset>
        <legend className="mb-1">Pick a look</legend>
        <div className="grid grid-cols-4 gap-2">
          {AVATARS.map((a) => (
            <label
              key={a.id}
              className={`rpg-window rpg-card p-2 text-center ${avatar === a.id ? "bg-coin-light" : ""}`}
            >
              <input
                type="radio"
                name="avatar"
                className="sr-only"
                checked={avatar === a.id}
                onChange={() => setAvatar(a.id)}
              />
              <PixelPerson look={a.look} size={36} className="mx-auto mb-1 block" />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>
      {join.isError && (
        <p role="alert" className="text-gold-ink">
          {offline(join.error)
            ? "No connection. Check your signal and try again."
            : "We could not let you in just now. Please try again."}
        </p>
      )}
      <button
        className="rpg-btn rpg-btn-go w-full text-lg"
        disabled={trimmed === "" || tooLong || join.isPending}
        onClick={() => join.mutate()}
      >
        Join the market
      </button>
    </div>
  )
}

function LotList({ onPick }: { onPick(lotId: string): void }) {
  const lots = useTown((s) => s.town.lots)
  const block = useTown((s) => s.town.block)
  const open = Object.values(lots).filter((l) => l.status === "open" && l.endBlock > block)
  if (open.length === 0) return <p className="text-ink-soft">No lots are open right now. Watch the big screen.</p>
  return (
    <ul className="space-y-2">
      {open.map((l) => (
        <li key={l.lotId}>
          <button className="rpg-window rpg-card p-3" onClick={() => onPick(l.lotId)}>
            Lot {l.lotId} · {l.qty} {l.unit} {l.commodity} · {l.clearingPerUnit ? "now" : "from"}{" "}
            {lotPerUnit(l, l.clearingPerUnit ?? l.floorPerUnit)} · ends in {countdown(l.endBlock, block)}
          </button>
        </li>
      ))}
    </ul>
  )
}

function BidForm({
  lot,
  session,
  onPlaced,
  onBack,
}: {
  lot: LotState
  session: WalkinSession
  onPlaced(p: Placed): void
  onBack(): void
}) {
  const [step, setStep] = useState(0)
  const [amountText, setAmountText] = useState("")
  const plan = tickPlan(BigInt(lot.floorPerUnit), lot.clearingPerUnit ? BigInt(lot.clearingPerUnit) : undefined)
  const q = priceAt(plan, step)
  const perUnit = apiMaxPerUnit(q)
  const currency = asCurrency(lot.currency) ?? "USD"
  const budget = session.budget ? BigInt(session.budget) : DEFAULT_BUDGET
  const amount = checkAmount(amountText, budget, currency)
  const bid = useMutation({
    mutationFn: (value: bigint) =>
      api.walkinBid({
        body: { token: session.token, lotId: lot.lotId, maxPerUnit: perUnit.toString(), amount: value.toString() },
      }),
    onSuccess: (_, value) => onPlaced({ lotId: lot.lotId, q, amount: value }),
  })
  return (
    <section aria-label={`Bid on Lot ${lot.lotId}`} className="rpg-window space-y-3 p-4">
      <h2 className="text-lg font-bold">
        Lot {lot.lotId} · {lot.qty} {unitLabel(lot.unit)} {lot.commodity} from {lot.sellerName}
      </h2>
      <label className="block">
        <span className="block">Your highest price</span>
        <input
          type="range"
          className="w-full"
          min={0}
          max={SLIDER_STEPS - 1}
          step={1}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        />
      </label>
      <p role="status" aria-label="Price" className="text-2xl font-bold">
        {lotPerUnit(lot, perUnit.toString())}
      </p>
      <label className="block">
        <span className="block">How much to spend ({currency})</span>
        <input
          className="rpg-input mt-2 w-full text-lg"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </label>
      {amountText !== "" && !amount.ok && <p className="text-sm text-gold-ink">{amount.error}</p>}
      {amount.ok && (
        <p className="text-sm text-ink-soft">
          About {maxUnits(amount.value, perUnit).toString()} {unitLabel(lot.unit)} at most
        </p>
      )}
      {bid.isError && (
        <p role="alert" className="text-gold-ink">
          {offline(bid.error)
            ? "No connection. Check your signal and try again."
            : "We could not place your bid. Please try again."}
        </p>
      )}
      <button
        className="rpg-btn rpg-btn-go w-full text-lg"
        disabled={!amount.ok || bid.isPending}
        onClick={() => amount.ok && bid.mutate(amount.value)}
      >
        Place bid
      </button>
      <button className="rpg-btn rpg-btn-quiet w-full" onClick={onBack}>
        Other lots
      </button>
      <TestMoneyBadge />
    </section>
  )
}

function Settled({ lot, agentId }: { lot: LotState; agentId: string }) {
  const winners = useWinners(lot)
  if (!winners) return <p>Checking the result…</p>
  const mine = winners.find((w) => w.buyer.toLowerCase() === agentId.toLowerCase())
  if (!mine) return <p>Not won. Nothing was charged.</p>
  return (
    <p className="text-lg font-bold">
      You won about {(BigInt(mine.tokenAmount) / 10n ** 18n).toString()} {unitLabel(lot.unit)}.
    </p>
  )
}

function Result({ placed, session, onAgain }: { placed: Placed; session: WalkinSession; onAgain(): void }) {
  const lot = useTown((s) => s.town.lots[placed.lotId])
  if (!lot) return null
  const clearingQ96 = toQ96(BigInt(lot.clearingPerUnit ?? lot.floorPerUnit))
  return (
    <section aria-label="Your bid" className="rpg-window space-y-2 bg-meadow-tint p-4">
      <p>
        Your bid is in: up to {lotPerUnit(lot, apiMaxPerUnit(placed.q).toString())},{" "}
        {lotMoney(lot, placed.amount.toString())} to spend.
      </p>
      {lot.settlement ? (
        <Settled lot={lot} agentId={session.agentId} />
      ) : lot.status === "open" ? (
        <p className="text-lg font-bold">
          {placed.q > clearingQ96 ? "You're winning right now." : "Outbid. Raise your price to stay in."}
        </p>
      ) : (
        <p>Waiting for the result…</p>
      )}
      <p className="text-sm text-ink-soft">Watch the big screen for your name.</p>
      <button className="rpg-btn rpg-btn-quiet w-full" onClick={onAgain}>
        Bid again
      </button>
      <TestMoneyBadge />
    </section>
  )
}

function Market({ session, onLeave }: { session: WalkinSession; onLeave(): void }) {
  const lots = useTown((s) => s.town.lots)
  const [lotId, setLotId] = useState<string | null>(null)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const lot = lotId ? lots[lotId] : undefined
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-lg">Hi {session.name}</p>
        <button className="text-sm text-ink-soft underline" onClick={onLeave}>
          Leave
        </button>
      </div>
      {placed ? (
        <Result
          placed={placed}
          session={session}
          onAgain={() => {
            setPlaced(null)
            setLotId(null)
          }}
        />
      ) : lot && lot.status === "open" ? (
        <BidForm lot={lot} session={session} onPlaced={setPlaced} onBack={() => setLotId(null)} />
      ) : (
        <>
          {lotId && <p className="text-gold-ink">That auction has closed. Pick another lot.</p>}
          <LotList onPick={setLotId} />
        </>
      )}
    </div>
  )
}

/** QR walk-in (S3 3.2): join with a name, pick an open lot, bid with a price that snaps to valid ticks. */
export function WalkinPage() {
  const [session, setSession] = useState<WalkinSession | null>(() => loadSession())
  return (
    <section className="rpg-window mx-3 my-5 max-w-md space-y-4 p-4 sm:mx-auto">
      <h1 className="rpg-banner">Walk in</h1>
      {session ? (
        <Market
          session={session}
          onLeave={() => {
            clearSession()
            setSession(null)
          }}
        />
      ) : (
        <Join
          onJoined={(s) => {
            saveSession(s)
            setSession(s)
          }}
        />
      )}
    </section>
  )
}
