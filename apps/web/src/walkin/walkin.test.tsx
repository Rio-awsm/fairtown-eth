// @vitest-environment jsdom
import type { TownEvent } from "@fairtown/shared/protocol"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import type { ReactNode } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { WalkinQr } from "../hud/WalkinQr"
import { handlers } from "../mocks/handlers"
import { WalkinPage } from "../pages/Walkin"
import { townStore } from "../state/townStore"
import { SAMPLE_EVENTS as S, TX } from "../test/samples"
import { formatPerUnit } from "../money/format"
import { apiMaxPerUnit, priceAt, tickPlan } from "./model"
import { clearSession, loadSession, saveSession } from "./session"

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
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )
const noCryptoWords = () => expect(document.body.textContent).not.toMatch(CRYPTO)
const WALKIN = "0x000000000000000000000000000000000000010f"

const marigold: TownEvent = {
  ...S["lot.listed"],
  lotId: "30",
  building: "flower_hall",
  sector: "flowers",
  commodity: "marigold",
  qty: 2000,
  currency: "USD",
  place: "pune",
  floorPerUnit: "1200000",
  sellerName: "Ganesh Pawar",
  endBlock: 1090,
}
const open = () => ({
  ...run([marigold, { type: "price.tick", lotId: "30", clearingPerUnit: "1500000" }]),
  block: 1000,
})

beforeEach(() => {
  clearSession()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  act(() => townStore.setState({ town: open(), selection: null }))
})

async function join(name = "Priya") {
  wrap(<WalkinPage />)
  fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: name } })
  fireEvent.click(screen.getByRole("radio", { name: "Trader" }))
  fireEvent.click(screen.getByRole("button", { name: "Join the market" }))
  await screen.findByText(`Hi ${name}`)
}

describe("joining", () => {
  it("joins with a name and avatar and keeps the session", async () => {
    let sent: unknown
    server.use(
      http.post("*/api/walkin", async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ agentId: WALKIN, address: WALKIN, token: "s3ss10n" })
      }),
    )
    await join()
    expect(sent).toEqual({ name: "Priya" })
    expect(loadSession()).toMatchObject({ agentId: WALKIN, name: "Priya", avatar: "trader" })
    noCryptoWords()
  })

  it("needs a name of 32 characters or fewer", () => {
    wrap(<WalkinPage />)
    expect(screen.getByRole("button", { name: "Join the market" })).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "x".repeat(33) } })
    expect(screen.getByText("Use 32 letters or fewer")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Join the market" })).toBeDisabled()
  })

  it("comes back to the market after a reload", () => {
    saveSession({ agentId: WALKIN, address: WALKIN, token: "s", name: "Priya", avatar: "trader" })
    wrap(<WalkinPage />)
    expect(screen.getByText("Hi Priya")).toBeInTheDocument()
  })

  it("explains a failed join in plain words", async () => {
    server.use(
      http.post("*/api/walkin", () =>
        HttpResponse.json({ error: { code: "x", message: "rpc down" } }, { status: 500 }),
      ),
    )
    wrap(<WalkinPage />)
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Priya" } })
    fireEvent.click(screen.getByRole("button", { name: "Join the market" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not let you in just now. Please try again.")
    noCryptoWords()
  })
})

describe("bidding", () => {
  const plan = tickPlan(1_200_000n, 1_500_000n)

  it("lists open lots with price and countdown", async () => {
    await join()
    const lot = screen.getByRole("button", { name: /Lot 30/ })
    expect(plain(lot.textContent)).toBe("Lot 30 · 2000 kg marigold · now $1.50/kg · ends in 3:00")
  })

  it("only offers valid ticks above clearing, and sends the snapped price", async () => {
    let sent: { maxPerUnit: string; amount: string; lotId: string; token: string } | undefined
    server.use(
      http.post("*/api/walkin/bid", async ({ request }) => {
        sent = (await request.json()) as typeof sent
        return HttpResponse.json({ bidId: "7", tx: TX })
      }),
    )
    await join()
    fireEvent.click(screen.getByRole("button", { name: /Lot 30/ }))
    const slider = screen.getByRole("slider", { name: "Your highest price" })
    expect(slider).toHaveAttribute("min", "0")
    expect(slider).toHaveAttribute("step", "1")
    const first = formatPerUnit(apiMaxPerUnit(priceAt(plan, 0)), "USD", "kg")
    expect(plain(screen.getByRole("status", { name: "Price" }).textContent)).toBe(plain(first))
    fireEvent.change(slider, { target: { value: "5" } })
    fireEvent.change(screen.getByRole("textbox", { name: "How much to spend (USD)" }), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "Place bid" }))
    await screen.findByRole("region", { name: "Your bid" })
    expect(sent).toEqual({
      token: "walkin-mock-session",
      lotId: "30",
      maxPerUnit: apiMaxPerUnit(priceAt(plan, 5)).toString(),
      amount: "20000000",
    })
  })

  it("keeps the amount within the budget", async () => {
    await join()
    fireEvent.click(screen.getByRole("button", { name: /Lot 30/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "How much to spend (USD)" }), { target: { value: "150" } })
    expect(screen.getByText("You can spend up to $100.00")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Place bid" })).toBeDisabled()
  })

  it("shows how much the amount buys at most", async () => {
    await join()
    fireEvent.click(screen.getByRole("button", { name: /Lot 30/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "How much to spend (USD)" }), { target: { value: "20" } })
    expect(screen.getByText(/^About \d+ kg at most$/)).toBeInTheDocument()
  })

  it("tells you if you are winning, outbid, then whether you won", async () => {
    server.use(
      http.get("*/api/lots/:lotId", () =>
        HttpResponse.json({
          spec: {},
          status: "sold",
          bids: [],
          winners: [{ buyer: WALKIN, tokenAmount: (12n * 10n ** 18n).toString() }],
        }),
      ),
    )
    await join()
    fireEvent.click(screen.getByRole("button", { name: /Lot 30/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "How much to spend (USD)" }), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "Place bid" }))
    const card = await screen.findByRole("region", { name: "Your bid" })
    expect(plain(card.textContent)).toContain("Your bid is in: up to")
    expect(plain(card.textContent)).toContain("$20.00 to spend")
    expect(card).toHaveTextContent("You're winning right now.")

    act(() =>
      townStore.setState((s) => ({
        town: run([{ type: "price.tick", lotId: "30", clearingPerUnit: "2500000" }], s.town),
      })),
    )
    expect(card).toHaveTextContent("Outbid. Raise your price to stay in.")

    act(() => townStore.setState((s) => ({ town: run([{ ...S["lot.settled"], lotId: "30" }], s.town) })))
    expect(await within(card).findByText("You won about 12 kg.")).toBeInTheDocument()
    noCryptoWords()
  })

  it("explains a failed bid in plain words", async () => {
    server.use(
      http.post("*/api/walkin/bid", () =>
        HttpResponse.json({ error: { code: "guardrail", message: "max exceeds budget" } }, { status: 400 }),
      ),
    )
    await join()
    fireEvent.click(screen.getByRole("button", { name: /Lot 30/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "How much to spend (USD)" }), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "Place bid" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not place your bid. Please try again.")
    noCryptoWords()
  })

  it("says so when nothing is open", async () => {
    act(() => townStore.setState({ town: { ...initialTownState, block: 1000 } }))
    await join()
    expect(screen.getByText("No lots are open right now. Watch the big screen.")).toBeInTheDocument()
  })

  it("leaves the market and forgets the session", async () => {
    await join()
    fireEvent.click(screen.getByRole("button", { name: "Leave" }))
    expect(screen.getByRole("textbox", { name: "Your name" })).toBeInTheDocument()
    expect(loadSession()).toBeNull()
  })
})

describe("WalkinQr", () => {
  it("points phones at /walkin on the public address and can be hidden", async () => {
    wrap(<WalkinQr publicUrl="https://fairtown.example" />)
    const img = await screen.findByRole("img", { name: "Scan to join and bid" })
    expect(img).toHaveAttribute("data-qr", "https://fairtown.example/walkin")
    fireEvent.click(screen.getByRole("button", { name: "Hide" }))
    expect(screen.queryByRole("img", { name: "Scan to join and bid" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show join QR" })).toBeInTheDocument()
  })

  it("warns when the public address is not set", async () => {
    wrap(<WalkinQr publicUrl={undefined} />)
    expect(await screen.findByText("Set PUBLIC_WEB_URL so phones can open this.")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-qr", `${window.location.origin}/walkin`))
  })
})
