// @vitest-environment jsdom
import type { TownEvent } from "@fairtown/shared/protocol"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import type { ReactNode } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { handlers } from "../mocks/handlers"
import { SellPage } from "../pages/Sell"
import { townStore } from "../state/townStore"
import { SAMPLE_EVENTS as S, TX } from "../test/samples"
import { CameraCapture } from "./CameraCapture"
import { MicButton } from "./MicButton"

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const CRYPTO = /\b(wallet|gas|token|crypto|blockchain)\b/i
const plain = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ")
const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  )
const noCryptoWords = () => expect(document.body.textContent).not.toMatch(CRYPTO)

beforeEach(() => act(() => townStore.setState({ town: initialTownState, selection: null })))

async function draftAsIngrid() {
  wrap(<SellPage />)
  fireEvent.click(screen.getByRole("button", { name: /Ingrid Solheim/ }))
  fireEvent.change(screen.getByRole("textbox", { name: "What are you selling?" }), {
    target: { value: "600 kg cod, landed 04:40, Bergen" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  return screen.findByRole("region", { name: "Your listing" })
}

describe("SellPage", () => {
  it("starts with the seller picker and no crypto words", () => {
    wrap(<SellPage />)
    expect(screen.getByRole("button", { name: /Ingrid Solheim/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Maya Torres/ })).toBeInTheDocument()
    noCryptoWords()
  })

  it("drafts a listing with grade, floor and its reason, advice and the payout preview before Confirm", async () => {
    const card = await draftAsIngrid()
    expect(card).toHaveTextContent("600 kg cod")
    expect(card).toHaveTextContent("bergen")
    expect(card).toHaveTextContent("Grade fresh_a · 92% sure")
    expect(card).toHaveTextContent("New seller")
    expect(plain(card.textContent)).toContain("Reference price €8.30 (mock, 2026-11-06)")
    expect(await screen.findByText("Storm tomorrow: list before 05:00 for more buyers.")).toBeInTheDocument()
    const preview = await screen.findByRole("status", { name: "What you will receive" })
    await waitFor(() =>
      expect(plain(preview.textContent)).toBe(
        "At least €2,227.50 at sale, about NOK 26,222, and the rest at handover.",
      ),
    )
    const confirm = screen.getByRole("button", { name: "Confirm and start selling" })
    expect(preview.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    noCryptoWords()
  })

  it("updates the preview when the seller changes the floor and blocks a bad price", async () => {
    await draftAsIngrid()
    const floor = screen.getByRole("textbox", { name: "Lowest price per kg (EUR)" })
    fireEvent.change(floor, { target: { value: "8.00" } })
    await waitFor(() =>
      expect(plain(screen.getByRole("status", { name: "What you will receive" }).textContent)).toMatch(
        /^At least €2,376.00 at sale/,
      ),
    )
    fireEvent.change(floor, { target: { value: "abc" } })
    expect(screen.getByText("Enter a price like 7.50")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Confirm and start selling" })).toBeDisabled()
  })

  it("confirms with the chosen floor, then shows the live stall", async () => {
    let sent: unknown
    server.use(
      http.post("*/api/listings/confirm", async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ lotId: "12", auction: `0x${"1".repeat(40)}`, token: `0x${"2".repeat(40)}`, tx: TX })
      }),
    )
    await draftAsIngrid()
    act(() =>
      townStore.setState({ town: { ...run([S["lot.listed"], S["bid.placed"], S["price.tick"]]), block: 1000 } }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start selling" }))
    const live = await screen.findByRole("region", { name: "Selling now" })
    expect(sent).toEqual({ draftId: "draft-12", floorPerUnit: "7500000", durationBlocks: 150 })
    expect(live).toHaveTextContent("1 bid")
    expect(live).toHaveTextContent("now €8.10/kg")
    expect(live).toHaveTextContent("ends in 1:30")
    noCryptoWords()
  })

  it("shows the money received with a plain split and a receipt once sold", async () => {
    await draftAsIngrid()
    act(() => townStore.setState({ town: run([S["lot.listed"], S["lot.settled"]]) }))
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start selling" }))
    const card = await screen.findByRole("region", { name: "Payout" })
    expect(plain(card.textContent)).toContain("€2,702.70 received")
    expect(plain(card.textContent)).toContain("€2,702.70 more at handover")
    expect(plain(card.textContent)).toContain("Fee €54.60")
    expect(screen.getByRole("link", { name: "Receipt" })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${TX}`,
    )
    expect(screen.getByRole("button", { name: "Show handover code" })).toBeInTheDocument()
    expect(screen.getByText("TEST MONEY")).toBeInTheDocument()
    noCryptoWords()
  })

  it("explains a failed draft in plain words", async () => {
    server.use(
      http.post("*/api/listings/draft", () =>
        HttpResponse.json({ error: { code: "ai_down", message: "LLM timeout at gateway" } }, { status: 503 }),
      ),
    )
    wrap(<SellPage />)
    fireEvent.click(screen.getByRole("button", { name: /Ingrid Solheim/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "What are you selling?" }), {
      target: { value: "600 kg cod" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not read that just now. Please try again.")
    noCryptoWords()
  })

  it("does not send an empty message", () => {
    wrap(<SellPage />)
    fireEvent.click(screen.getByRole("button", { name: /Ingrid Solheim/ }))
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })

  it("lists past lots and payouts in the history tab", async () => {
    wrap(<SellPage />)
    fireEvent.click(screen.getByRole("button", { name: /Ingrid Solheim/ }))
    fireEvent.click(screen.getByRole("tab", { name: "History" }))
    const history = await screen.findByRole("region", { name: "History" })
    await waitFor(() => expect(history).toHaveTextContent("Lot 12 · 600 kg cod · Paid in full"))
    expect(plain(history.textContent)).toContain("€2,702.70 at sale")
    expect(plain(history.textContent)).toContain("€2,702.70 at handover")
    noCryptoWords()
  })
})

describe("CameraCapture", () => {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream

  it("shows the lot code to hold in the photo and saves photos with code, time and place", async () => {
    const onPhoto = vi.fn()
    render(
      <CameraCapture
        lotCode="0427"
        count={0}
        max={3}
        onPhoto={onPhoto}
        getMedia={async () => stream}
        grab={() => "data:image/jpeg;base64,AAAA"}
        locate={async () => ({ lat: 60.39, lon: 5.32 })}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open camera" }))
    expect(await screen.findByText("Hold the code 0427 in the photo")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    await waitFor(() => expect(onPhoto).toHaveBeenCalledTimes(1))
    expect(onPhoto.mock.calls[0]![0]).toMatchObject({
      dataUrl: "data:image/jpeg;base64,AAAA",
      lotCode: "0427",
      gps: { lat: 60.39, lon: 5.32 },
      capturedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    })
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(stop).toHaveBeenCalled()
  })

  it("saves a photo without a place when location is refused", async () => {
    const onPhoto = vi.fn()
    render(
      <CameraCapture
        lotCode="1111"
        count={0}
        max={3}
        onPhoto={onPhoto}
        getMedia={async () => stream}
        grab={() => "data:image/jpeg;base64,AAAA"}
        locate={async () => undefined}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open camera" }))
    fireEvent.click(await screen.findByRole("button", { name: "Take photo" }))
    await waitFor(() => expect(onPhoto).toHaveBeenCalled())
    expect(onPhoto.mock.calls[0]![0].gps).toBeUndefined()
  })

  it("explains a blocked camera and offers no file upload", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" })
    render(
      <CameraCapture
        lotCode="0427"
        count={0}
        max={3}
        onPhoto={vi.fn()}
        getMedia={async () => Promise.reject(denied)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open camera" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The camera is blocked. Allow it for this site in your phone settings, then try again.",
    )
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it("stops at the photo limit", () => {
    render(<CameraCapture lotCode="0427" count={3} max={3} onPhoto={vi.fn()} getMedia={async () => stream} />)
    expect(screen.getByRole("button", { name: "Open camera" })).toBeDisabled()
    expect(screen.getByText("3 of 3 photos")).toBeInTheDocument()
  })
})

describe("MicButton", () => {
  it("uses browser speech in English", async () => {
    const instances: { lang: string; start: () => void; onresult?: (e: unknown) => void }[] = []
    class FakeSpeech {
      lang = ""
      onresult?: (e: unknown) => void
      onerror?: () => void
      onend?: () => void
      constructor() {
        instances.push(this as never)
      }
      start() {}
      stop() {}
    }
    const onText = vi.fn()
    render(<MicButton win={{ webkitSpeechRecognition: FakeSpeech }} onText={onText} />)
    fireEvent.click(screen.getByRole("button", { name: "Speak" }))
    expect(instances[0]!.lang).toBe("en-US")
    act(() => instances[0]!.onresult?.({ results: [[{ transcript: "600 kg cod" }]] }))
    expect(onText).toHaveBeenCalledWith("600 kg cod")
  })

  it("records and sends audio to the speech service when the browser cannot transcribe", async () => {
    let recorder: { ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void } | undefined
    class FakeRecorder {
      ondataavailable?: (e: { data: Blob }) => void
      onstop?: () => void
      constructor() {
        recorder = this as never
      }
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["abc"], { type: "audio/webm" }) })
        this.onstop?.()
      }
    }
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    const onText = vi.fn()
    wrap(<MicButton win={{ MediaRecorder: FakeRecorder }} getMedia={async () => stream} onText={onText} />)
    fireEvent.click(screen.getByRole("button", { name: "Speak" }))
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }))
    await waitFor(() => expect(onText).toHaveBeenCalledWith("600 kg cod, landed 04:40, Bergen"))
    expect(recorder).toBeDefined()
  })

  it("is hidden when the phone can neither transcribe nor record", () => {
    const { container } = render(<MicButton win={{}} onText={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
