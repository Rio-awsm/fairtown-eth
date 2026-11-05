// @vitest-environment jsdom
import type { TownEvent } from "@fairtown/shared/protocol"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { handlers } from "../mocks/handlers"
import { MOCK_HANSE, MOCK_LOT12_UNITS, mockFallbackUrl, mockQrText, mockTicket } from "../mocks/ticket"
import { ScanPage } from "../pages/Scan"
import { SellPage } from "../pages/Sell"
import { townStore } from "../state/townStore"
import { BUYER, SAMPLE_EVENTS as S, TRUCK } from "../test/samples"
import { ShowCode } from "./ShowCode"

let fakeScan: ((text: string) => void) | undefined
let fakeError: ((e: unknown) => void) | undefined
vi.mock("./QrScanner", () => ({
  QrScanner: ({ onCode, onError }: { onCode(t: string): void; onError(e: unknown): void }) => {
    fakeScan = onCode
    fakeError = onError
    return <div data-testid="scanner" />
  },
}))

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const CRYPTO = /\b(wallet|gas|token|crypto|blockchain)\b/i
const plain = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ")
const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>)
const routed = (path: string, element: ReactNode) =>
  render(
    <QueryClientProvider client={client()}>
      <RouterProvider router={createMemoryRouter([{ path: "/:page", element }], { initialEntries: [path] })} />
    </QueryClientProvider>,
  )

/** Lot 12 sold to Hanse Kitchen (BUYER), Lars (TRUCK) assigned, block 1100. */
const bergen = () => ({
  ...run([
    S["lot.listed"],
    S["agent.spawned"],
    { ...S["agent.spawned"], agentId: TRUCK, name: "Lars", role: "TRUCK", building: "freight_yard" },
    {
      ...S["agent.spawned"],
      agentId: "0x0000000000000000000000000000000000000106",
      name: "Gulf Produce",
      role: "BUYER",
      building: "freight_yard",
    },
    S["bid.placed"],
    S["lot.settled"],
    S["carrier.assigned"],
  ]),
  block: 1100,
})
const seed = (town: TownState) => act(() => townStore.setState({ town, selection: null }))
const code = mockQrText(mockTicket("12", BUYER, MOCK_LOT12_UNITS))

beforeEach(() => {
  seed(bergen())
  fakeScan = undefined
})

describe("ShowCode", () => {
  it("draws the handover code for the winner, with expiry and a no-camera link", async () => {
    wrap(<ShowCode lot={bergen().lots["12"]!} sellerId="ingrid" />)
    const img = await screen.findByRole("img", { name: "Handover code for Lot 12" })
    expect(img).toHaveAttribute("data-qr", mockQrText(mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS)))
    expect(screen.getByText(/^Expires in \d+:\d\d$/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open without the camera" })).toHaveAttribute(
      "href",
      expect.stringContaining("/scan?code="),
    )
    expect(document.body.textContent).not.toMatch(CRYPTO)
  })

  it("says when the code has expired and makes a new one", async () => {
    let requests = 0
    server.use(
      http.post("*/api/handover/ticket", () => {
        requests++
        const ticket = {
          ...mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS),
          expiryBlock: requests === 1 ? "1050" : "5000",
        }
        return HttpResponse.json({
          ticket,
          qrText: JSON.stringify(ticket),
          fallbackUrl: mockFallbackUrl(JSON.stringify(ticket)),
        })
      }),
    )
    wrap(<ShowCode lot={bergen().lots["12"]!} sellerId="ingrid" />)
    expect(await screen.findByText("This code has expired.")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: /Handover code/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "New code" }))
    expect(await screen.findByRole("img", { name: "Handover code for Lot 12" })).toBeInTheDocument()
    expect(requests).toBe(2)
  })

  it("never guesses between several buyers", async () => {
    server.use(http.get("*/api/lots/:lotId", () => HttpResponse.json({ spec: {}, status: "sold", bids: [] })))
    const two = run([{ ...S["bid.placed"], agentId: TRUCK }], bergen())
    wrap(<ShowCode lot={two.lots["12"]!} sellerId="ingrid" />)
    expect(
      await screen.findByText("Several buyers won this lot. Ask the market desk which code to show."),
    ).toBeInTheDocument()
  })
})

describe("ScanPage", () => {
  const confirmSpy = () => {
    const bodies: unknown[] = []
    server.use(
      http.post("*/api/handover/confirm", async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ tx: `0x${"ef".repeat(32)}`, releasedToSeller: "2702700000" })
      }),
    )
    return bodies
  }

  it("asks who is receiving, from the people in town", () => {
    routed("/scan", <ScanPage />)
    expect(screen.getByRole("button", { name: /Hanse Kitchen/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Lars/ })).toBeInTheDocument()
  })

  it("shows what changes hands and sends nothing until Confirm", async () => {
    const bodies = confirmSpy()
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Hanse Kitchen/ }))
    await screen.findByTestId("scanner")
    act(() => fakeScan!(code))
    const card = await screen.findByRole("region", { name: "Handover" })
    expect(card).toHaveTextContent("600 kg cod from Ingrid Solheim, Lot 12.")
    expect(card).toHaveTextContent("Inspect first. Scanning means you accept the goods.")
    expect(bodies).toEqual([])
    fireEvent.click(within(card).getByRole("button", { name: "Confirm" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Done. €2,702.70 released to Ingrid Solheim.")
    expect(bodies).toEqual([{ receiverId: BUYER, ticket: JSON.parse(code) }])
    expect(document.body.textContent).not.toMatch(CRYPTO)
  })

  it("opens a code from the fallback link without the camera", async () => {
    routed(`/scan?code=${encodeURIComponent(code)}`, <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Lars/ }))
    expect(await screen.findByRole("region", { name: "Handover" })).toHaveTextContent("Lot 12")
    expect(screen.queryByTestId("scanner")).not.toBeInTheDocument()
  })

  it("explains an expired code and offers no Confirm", async () => {
    seed({ ...bergen(), block: 6000 })
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Hanse Kitchen/ }))
    await screen.findByTestId("scanner")
    act(() => fakeScan!(code))
    expect(await screen.findByRole("alert")).toHaveTextContent("This code has expired. Ask for a new one.")
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }))
    expect(screen.getByTestId("scanner")).toBeInTheDocument()
  })

  it("explains a code for someone else", async () => {
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Gulf Produce/ }))
    await screen.findByTestId("scanner")
    act(() => fakeScan!(code))
    expect(await screen.findByRole("alert")).toHaveTextContent("This code is for someone else.")
  })

  it("explains a QR that is not a handover code", async () => {
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Hanse Kitchen/ }))
    await screen.findByTestId("scanner")
    act(() => fakeScan!("https://example.com/menu"))
    expect(await screen.findByRole("alert")).toHaveTextContent("This isn't a Fairtown handover code.")
  })

  it("explains a blocked camera and points to the link", async () => {
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Hanse Kitchen/ }))
    await screen.findByTestId("scanner")
    act(() => fakeError!(Object.assign(new Error("denied"), { name: "NotAllowedError" })))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The camera is blocked. Allow it in your phone settings, or open the link under the seller's code.",
    )
  })

  it("says so in plain words when Confirm fails", async () => {
    server.use(
      http.post("*/api/handover/confirm", () =>
        HttpResponse.json({ error: { code: "revert", message: "execution reverted" } }, { status: 409 }),
      ),
    )
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Hanse Kitchen/ }))
    await screen.findByTestId("scanner")
    act(() => fakeScan!(code))
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not confirm the handover. Please try again.")
    expect(document.body.textContent).not.toMatch(CRYPTO)
  })

  it("opens a problem report that needs a photo", async () => {
    routed("/scan", <ScanPage />)
    fireEvent.click(screen.getByRole("button", { name: /Hanse Kitchen/ }))
    await screen.findByTestId("scanner")
    act(() => fakeScan!(code))
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }))
    const form = screen.getByRole("region", { name: "Report a problem" })
    expect(within(form).getByRole("button", { name: "Send report" })).toBeDisabled()
    expect(within(form).getByText("Take at least one photo of the problem.")).toBeInTheDocument()
  })
})

describe("no-show", () => {
  it("asks the seller to answer a reported no-show with a photo", async () => {
    seed({ ...run([S["noshow.reported"]], bergen()), block: 1400 })
    wrap(<SellPage />)
    fireEvent.click(screen.getByRole("button", { name: /Ingrid Solheim/ }))
    const answer = await screen.findByRole("region", { name: "No-show reported" })
    expect(plain(answer.textContent)).toContain("The buyer says you didn't hand over. Answer in 3:20")
    expect(within(answer).getByRole("button", { name: "Send proof" })).toBeDisabled()
  })

  it("lists the seller's sold lots with a handover code button", async () => {
    wrap(<SellPage />)
    fireEvent.click(screen.getByRole("button", { name: /Ingrid Solheim/ }))
    const mine = screen.getByRole("region", { name: "Your sold lots" })
    fireEvent.click(within(mine).getByRole("button", { name: "Show handover code" }))
    expect(await screen.findByRole("img", { name: "Handover code for Lot 12" })).toBeInTheDocument()
  })
})
