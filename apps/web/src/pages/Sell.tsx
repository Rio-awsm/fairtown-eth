import type { LotDraft } from "@fairtown/shared/api"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import type { z } from "zod"
import { api } from "../net/api"
import { ApiClientError } from "../net/apiClient"
import { CameraCapture, type CapturedPhoto } from "../sell/CameraCapture"
import { DraftCard } from "../sell/DraftCard"
import { History } from "../sell/History"
import { LiveStatus } from "../sell/LiveStatus"
import { MicButton } from "../sell/MicButton"
import { SoldLots } from "../sell/SoldLots"
import { DEMO_SELLERS, DURATION_BLOCKS, newLotCode, type DemoSeller } from "../sell/model"
import { PixelPerson } from "../hud/PixelPerson"

type Draft = z.infer<typeof LotDraft>
const MAX_PHOTOS = 3

/** Plain words only: no codes, no technical terms on /sell (golden rule 7). */
const plainError = (error: unknown, what: string) =>
  error instanceof ApiClientError && error.code === "network" ? "No connection. Check your signal and try again." : what

function Picker({ onPick }: { onPick(s: DemoSeller): void }) {
  return (
    <ul className="space-y-2">
      {DEMO_SELLERS.map((s) => (
        <li key={s.id}>
          <button className="rpg-window rpg-card flex items-center gap-4 p-4" onClick={() => onPick(s)}>
            <PixelPerson id={s.id} role="SELLER" size={36} />
            <span>
              <span className="block text-lg font-bold">{s.name}</span>
              <span className="text-sm text-ink-soft">
                {s.what} · {s.place}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Seller({ seller }: { seller: DemoSeller }) {
  const [tab, setTab] = useState<"sell" | "history">("sell")
  const [text, setText] = useState("")
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [lotCode] = useState(() => newLotCode())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [lotId, setLotId] = useState<string | null>(null)

  const drafting = useMutation({
    mutationFn: () =>
      api.draftListing({ body: { sellerId: seller.id, text, ...(photos.length > 0 ? { photos } : {}) } }),
    onSuccess: setDraft,
  })
  const confirming = useMutation({
    mutationFn: (floorPerUnit: bigint) =>
      api.confirmListing({
        body: { draftId: draft!.draftId, floorPerUnit: floorPerUnit.toString(), durationBlocks: DURATION_BLOCKS },
      }),
    onSuccess: (res) => setLotId(res.lotId),
  })

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Selling as {seller.name}</p>
      <div role="tablist" className="flex gap-2">
        {(["sell", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`rpg-btn rpg-btn-sm flex-1 ${tab === t ? "" : "rpg-btn-quiet"}`}
            onClick={() => setTab(t)}
          >
            {t === "sell" ? "Sell" : "History"}
          </button>
        ))}
      </div>
      {tab === "history" && <History sellerId={seller.id} />}
      {tab === "sell" && lotId && <LiveStatus lotId={lotId} sellerId={seller.id} />}
      {tab === "sell" && !lotId && draft && (
        <DraftCard
          draft={draft}
          sellerId={seller.id}
          confirming={confirming.isPending}
          error={
            confirming.isError ? plainError(confirming.error, "We could not start the sale. Please try again.") : null
          }
          onConfirm={(floor) => confirming.mutate(floor)}
        />
      )}
      {tab === "sell" && !lotId && !draft && <SoldLots sellerName={seller.name} sellerId={seller.id} />}
      {tab === "sell" && !lotId && !draft && (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm">What are you selling?</span>
            <textarea
              className="rpg-input mt-2 w-full text-lg"
              rows={3}
              placeholder="600 kg cod, landed 04:40, Bergen"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <MicButton onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
          <CameraCapture
            lotCode={lotCode}
            count={photos.length}
            max={MAX_PHOTOS}
            onPhoto={(p) => setPhotos((prev) => [...prev, p].slice(0, MAX_PHOTOS))}
          />
          {drafting.isError && (
            <p role="alert" className="text-sm text-gold-ink">
              {plainError(drafting.error, "We could not read that just now. Please try again.")}
            </p>
          )}
          <button
            className="rpg-btn rpg-btn-go w-full text-lg"
            disabled={text.trim() === "" || drafting.isPending}
            onClick={() => drafting.mutate()}
          >
            {drafting.isPending ? "Reading…" : "Send"}
          </button>
        </div>
      )}
    </div>
  )
}

/** Seller chat (S3 2.1): mobile-first, no crypto words, preview before confirming, test money labelled. */
export function SellPage() {
  const [seller, setSeller] = useState<DemoSeller | null>(null)
  return (
    <section className="rpg-window mx-3 my-5 max-w-md space-y-4 p-4 sm:mx-auto">
      <h1 className="rpg-banner">Sell</h1>
      {seller ? <Seller key={seller.id} seller={seller} /> : <Picker onPick={setSeller} />}
    </section>
  )
}
