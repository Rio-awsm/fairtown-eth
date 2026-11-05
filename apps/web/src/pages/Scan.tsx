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

function Confirm({ ticket, lot, receiver }: { ticket: TicketJson; lot: LotState; receiver: AgentState }) {
  const [reporting, setReporting] = useState(false)
  const confirm = useMutation({
    mutationFn: () => api.handoverConfirm({ body: { receiverId: receiver.agentId, ticket } }),
  })
  if (confirm.isSuccess)
    return (
      <p role="status" className="rounded bg-emerald-950 p-3 text-lg">
        Done. {lotMoney(lot, confirm.data.releasedToSeller)} released to {lot.sellerName}.
      </p>
    )
  return (
    <div className="space-y-3">
      <section aria-label="Handover" className="space-y-3 rounded bg-slate-900 p-3">
        <p className="text-xl font-bold">{describeTicket(ticket, lot)}</p>
        <p className="rounded bg-amber-400 p-2 font-bold text-black">
          Inspect first. Scanning means you accept the goods.
        </p>
        {confirm.isError && (
          <p role="alert" className="text-amber-300">
            {confirm.error instanceof ApiClientError && confirm.error.code === "network"
              ? "No connection. Check your signal and try again."
              : "We could not confirm the handover. Please try again."}
          </p>
        )}
        <button
          className="w-full rounded bg-emerald-700 py-3 text-lg font-bold disabled:opacity-50"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate()}
        >
          Confirm
        </button>
        <button className="w-full rounded bg-slate-700 py-3" onClick={() => setReporting(true)}>
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
  const [text, setText] = useState<string | null>(() => params.get("code"))
  const [cameraError, setCameraError] = useState<string | null>(null)
  const receivers = Object.values(town.agents).filter((a) => RECEIVER_ROLES.has(a.role))

  let body
  if (!receiver) {
    body = (
      <div className="space-y-2">
        <p>Who is receiving the goods?</p>
        {receivers.length === 0 && <p className="text-slate-300">Waiting for the town…</p>}
        {receivers.map((a) => (
          <button
            key={a.agentId}
            className="block w-full rounded bg-slate-800 p-3 text-left"
            onClick={() => setReceiver(a)}
          >
            <span className="block font-bold">{a.ensName ?? a.name}</span>
            <span className="text-sm text-slate-300">{ROLE_WORDS[a.role] ?? a.role}</span>
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
          <p role="alert" className="text-amber-300">
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
        <Confirm ticket={read.ticket} lot={checked.lot} receiver={receiver} />
      ) : (
        <div className="space-y-2">
          <p role="alert" className="rounded bg-red-950 p-3">
            {checked.ok ? "" : checked.error}
          </p>
          <button className="w-full rounded bg-slate-700 py-3" onClick={() => setText(null)}>
            Scan again
          </button>
        </div>
      )
  }

  return (
    <section className="mx-auto max-w-md space-y-3 p-3">
      <h1 className="text-2xl font-bold">Handover</h1>
      {receiver && <p className="text-sm text-slate-300">Receiving as {receiver.ensName ?? receiver.name}</p>}
      {body}
    </section>
  )
}
