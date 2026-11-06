import type { TicketJson } from "@fairtown/shared/handover"
import { useMutation } from "@tanstack/react-query"
import { lazy, Suspense, useState } from "react"
import { useSearchParams } from "react-router"
import type { AgentState, LotState } from "../game/reducer"
import { cameraProblem, checkTicket, describeTicket, readCode } from "../handover/model"
import { ReportProblem } from "../handover/ReportProblem"
import { lotMoney } from "../hud/model"
import { api } from "../net/api"
import { ApiClientError } from "../net/apiClient"
import { useTown } from "../state/townStore"

// Lazy: the QR decoder only loads once someone is ready to scan.
const QrScanner = lazy(() => import("../handover/QrScanner").then((m) => ({ default: m.QrScanner })))
const RECEIVER_ROLES = new Set(["BUYER", "TRUCK", "STORAGE", "SOCIETY", "HUMAN"])
const ROLE_WORDS: Record<string, string> = {
  BUYER: "Buyer",
  TRUCK: "Truck",
  STORAGE: "Cold store",
  SOCIETY: "Housing society",
  HUMAN: "Visitor",
}

function Confirm({
  ticket,
  lot,
  receiver,
  onDone,
}: {
  ticket: TicketJson
  lot: LotState
  receiver: AgentState
  onDone(message: string): void
}) {
  const [reporting, setReporting] = useState(false)
  const confirm = useMutation({
    mutationFn: () => api.handoverConfirm({ body: { receiverId: receiver.agentId, ticket } }),
    // The page keeps the result: the relay's handover event re-checks the ticket a moment later (C 1.3).
    onSuccess: (r) => onDone(`Done. ${lotMoney(lot, r.releasedToSeller)} released to ${lot.sellerName}.`),
  })
  return (
    <div className="space-y-3">
      <section aria-label="Handover" className="rpg-window space-y-3 p-4">
        <p className="text-xl font-bold">{describeTicket(ticket, lot)}</p>
        <p className="rpg-badge bg-coin p-2 font-bold text-ink">Inspect first. Scanning means you accept the goods.</p>
        {confirm.isError && (
          <p role="alert" className="text-gold-ink">
            {confirm.error instanceof ApiClientError && confirm.error.code === "network"
              ? "No connection. Check your signal and try again."
              : "We could not confirm the handover. Please try again."}
          </p>
        )}
        <button
          className="rpg-btn rpg-btn-go w-full text-lg"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate()}
        >
          Confirm
        </button>
        <button className="rpg-btn rpg-btn-quiet w-full" onClick={() => setReporting(true)}>
          Report a problem
        </button>
      </section>
      {reporting && <ReportProblem buyerId={ticket.buyer} lotId={ticket.lotId} tokenAmount={ticket.tokenAmount} />}
    </div>
  )
}

/** Receiver's side of the QR handover (S3 2.2): who you are, scan, check, then Confirm or Report. */
export function ScanPage() {
  const [params] = useSearchParams()
  const town = useTown((s) => s.town)
  const [receiver, setReceiver] = useState<AgentState | null>(null)
  // A code arrives by camera, or in the link itself: `?code=` or the server's fallback `#t=` (ICR-009).
  const [text, setText] = useState<string | null>(
    () => params.get("code") ?? (/[#&]t=/.test(window.location.hash) ? window.location.hash : null),
  )
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const receivers = Object.values(town.agents).filter((a) => RECEIVER_ROLES.has(a.role))

  let body
  if (done) {
    body = (
      <p role="status" className="rpg-well bg-meadow-tint p-3 text-lg">
        {done}
      </p>
    )
  } else if (!receiver) {
    body = (
      <div className="space-y-2">
        <p>Who is receiving the goods?</p>
        {receivers.length === 0 && <p className="text-ink-soft">Waiting for the town…</p>}
        {receivers.map((a) => (
          <button key={a.agentId} className="rpg-window rpg-card p-3" onClick={() => setReceiver(a)}>
            <span className="block font-bold">{a.ensName ?? a.name}</span>
            <span className="text-sm text-ink-soft">{ROLE_WORDS[a.role] ?? a.role}</span>
          </button>
        ))}
      </div>
    )
  } else if (text === null) {
    body = (
      <div className="space-y-2">
        <p>Point the camera at the handover code.</p>
        <Suspense fallback={<p>Starting the camera…</p>}>
          <QrScanner
            onCode={setText}
            onError={(e) => {
              console.warn("scanner camera error", e)
              setCameraError(cameraProblem(e))
            }}
          />
        </Suspense>
        {cameraError && (
          <p role="alert" className="text-gold-ink">
            {cameraError}
          </p>
        )}
      </div>
    )
  } else {
    const read = readCode(text)
    const checked = read.ok ? checkTicket(read.ticket, town, receiver.agentId) : read
    body =
      read.ok && checked.ok ? (
        <Confirm ticket={read.ticket} lot={checked.lot} receiver={receiver} onDone={setDone} />
      ) : (
        <div className="space-y-2">
          <p role="alert" className="rpg-well bg-brick-tint p-3">
            {checked.ok ? "" : checked.error}
          </p>
          <button className="rpg-btn rpg-btn-quiet w-full" onClick={() => setText(null)}>
            Scan again
          </button>
        </div>
      )
  }

  return (
    <section className="rpg-window mx-3 my-5 max-w-md space-y-4 p-4 sm:mx-auto">
      <h1 className="rpg-banner">Handover</h1>
      {receiver && <p className="text-sm text-ink-soft">Receiving as {receiver.ensName ?? receiver.name}</p>}
      {body}
    </section>
  )
}
