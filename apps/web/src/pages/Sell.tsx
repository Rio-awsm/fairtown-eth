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
import { DEMO_SELLERS, DURATION_BLOCKS, newLotCode, type DemoSeller } from "../sell/model"

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
          <button className="w-full rounded bg-slate-800 p-4 text-left" onClick={() => onPick(s)}>
            <span className="block text-lg font-bold">{s.name}</span>
            <span className="text-sm text-slate-300">
              {s.what} · {s.place}
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
      <p className="text-sm text-slate-300">Selling as {seller.name}</p>
      <div role="tablist" className="flex gap-2">
        {(["sell", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`flex-1 rounded py-2 ${tab === t ? "bg-slate-700" : "bg-slate-900"}`}
            onClick={() => setTab(t)}
          >
            {t === "sell" ? "Sell" : "History"}
          </button>
        ))}
      </div>
      {tab === "history" && <History sellerId={seller.id} />}
      {tab === "sell" && lotId && <LiveStatus lotId={lotId} />}
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
      {tab === "sell" && !lotId && !draft && (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm">What are you selling?</span>
            <textarea
              className="mt-1 w-full rounded bg-slate-800 p-3 text-lg"
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
            <p role="alert" className="text-sm text-amber-300">
              {plainError(drafting.error, "We could not read that just now. Please try again.")}
            </p>
          )}
          <button
            className="w-full rounded bg-emerald-700 py-3 text-lg font-bold disabled:opacity-50"
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
    <section className="mx-auto max-w-md space-y-3 p-3">
      <h1 className="text-2xl font-bold">Sell</h1>
      {seller ? <Seller key={seller.id} seller={seller} /> : <Picker onPick={setSeller} />}
    </section>
  )
}
