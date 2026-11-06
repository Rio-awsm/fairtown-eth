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
import { resetMockAgents } from "../mocks/agents"
import { handlers } from "../mocks/handlers"
import { MOCK_HANSE, MOCK_LOT12_UNITS } from "../mocks/ticket"
import { BuyPage } from "../pages/Buy"
import { TownPage } from "../pages/Town"
import { townStore } from "../state/townStore"
import { SAMPLE_EVENTS as S, TX } from "../test/samples"

vi.mock("../town3d/TownCanvas", () => ({ TownCanvas: () => <div data-testid="town-3d" /> }))
vi.mock("../hud/PriceChart", () => ({ PriceChart: () => <div /> }))

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  server.resetHandlers()
  resetMockAgents()
})
afterAll(() => server.close())

const plain = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ")
const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const routed = (path: string, element: ReactNode) => {
  const router = createMemoryRouter([{ path: "/:page", element }], { initialEntries: [path] })
  render(
    <QueryClientProvider client={client()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

/** Hanse Kitchen (the mock API's buyer) bought Lot 12; the town is at block 1100. */
const town = () => ({
  ...run([
    S["lot.listed"],
    { ...S["agent.spawned"], agentId: MOCK_HANSE },
    { ...S["agent.intent"], agentId: MOCK_HANSE },
    { ...S["bid.placed"], agentId: MOCK_HANSE },
    S["lot.settled"],
  ]),
  block: 1100,
})
beforeEach(() => act(() => townStore.setState({ town: town(), selection: null })))

const openHanse = async () => {
  routed("/buy", <BuyPage />)
  fireEvent.click(await screen.findByRole("button", { name: /Hanse Kitchen/ }))
  return screen.findByRole("region", { name: "Hanse Kitchen" })
}

describe("create a buyer agent", () => {
  it("sends the mandate and budget in base units and opens the new agent", async () => {
    let sent: unknown
    server.use(
      http.post("*/api/buyers", async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ agentId: `0x${"1f0".padStart(40, "0")}`, address: `0x${"1f0".padStart(40, "0")}` })
      }),
    )
    routed("/buy", <BuyPage />)
    fireEvent.click(screen.getByRole("button", { name: "New buyer" }))
    const form = screen.getByRole("form", { name: "New buyer" })
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Oslo Fish Bar" } })
    fireEvent.click(within(form).getByLabelText("cod"))
    fireEvent.change(within(form).getByLabelText("Max price per unit"), { target: { value: "9.40" } })
    fireEvent.change(within(form).getByLabelText("Quantity"), { target: { value: "100" } })
    fireEvent.change(within(form).getByLabelText("Budget"), { target: { value: "2000" } })
    fireEvent.click(within(form).getByRole("button", { name: "Create buyer" }))
    await screen.findByRole("region", { name: "Oslo Fish Bar" })
    expect(sent).toEqual({
      name: "Oslo Fish Bar",
      role: "BUYER",
      currency: "EUR",
      mandate: { commodities: ["cod"], maxPerUnit: "9400000", qty: "100", avoidNoShowSellers: true },
      budget: "2000000000",
    })
  })

  it("shows every problem before sending anything", async () => {
    const posted = vi.fn()
    server.use(http.post("*/api/buyers", () => (posted(), HttpResponse.json({}))))
    routed("/buy", <BuyPage />)
    fireEvent.click(screen.getByRole("button", { name: "New buyer" }))
    const form = screen.getByRole("form", { name: "New buyer" })
    fireEvent.click(within(form).getByRole("button", { name: "Create buyer" }))
    expect(within(form).getByText("Give the buyer a name")).toBeInTheDocument()
    expect(within(form).getByText("Pick at least one thing to buy")).toBeInTheDocument()
    expect(within(form).getByText("Enter a budget")).toBeInTheDocument()
    expect(posted).not.toHaveBeenCalled()
  })

  it("explains a failed create in plain words", async () => {
    server.use(
      http.post("*/api/buyers", () => HttpResponse.json({ error: { code: "x", message: "y" } }, { status: 500 })),
    )
    routed("/buy", <BuyPage />)
    fireEvent.click(screen.getByRole("button", { name: "New buyer" }))
    const form = screen.getByRole("form", { name: "New buyer" })
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "A" } })
    fireEvent.click(within(form).getByLabelText("cod"))
    fireEvent.change(within(form).getByLabelText("Max price per unit"), { target: { value: "1" } })
    fireEvent.change(within(form).getByLabelText("Budget"), { target: { value: "10" } })
    fireEvent.click(within(form).getByRole("button", { name: "Create buyer" }))
    expect(await within(form).findByRole("alert")).toHaveTextContent("We could not create the buyer. Please try again.")
  })
})

describe("agent detail", () => {
  it("shows mandate and budget in plain money, decisions and bids with receipts", async () => {
    const detail = await openHanse()
    await waitFor(() => expect(plain(detail.textContent)).toContain("cod, haddock up to €9.40 per unit"))
    expect(plain(detail.textContent)).toContain("Budget €50,000.00")
    expect(plain(detail.textContent)).toContain("Avoids sellers with no-shows")
    expect(within(detail).getByRole("region", { name: "Decisions" })).toHaveTextContent("Grade A cod, storm tomorrow")
    const bids = within(detail).getByRole("table", { name: "Bids" })
    expect(plain(bids.textContent)).toContain("Lot 12")
    expect(plain(bids.textContent)).toContain("€9.40/kg")
    expect(within(bids).getByRole("link")).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${TX}`)
    expect(within(detail).getByRole("link", { name: "Watch in town" })).toHaveAttribute(
      "href",
      `/town?select=agent:${MOCK_HANSE}`,
    )
  })

  it("pauses and resumes the agent", async () => {
    const detail = await openHanse()
    fireEvent.click(await within(detail).findByRole("button", { name: "Pause" }))
    expect(await within(detail).findByText("Paused")).toBeInTheDocument()
    fireEvent.click(within(detail).getByRole("button", { name: "Resume" }))
    expect(await within(detail).findByText("Active")).toBeInTheDocument()
  })

  it("edits the max price", async () => {
    let sent: unknown
    server.use(
      http.patch("*/api/agents/:agentId", async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({
          agentId: MOCK_HANSE,
          name: "Hanse Kitchen",
          role: "BUYER",
          currency: "EUR",
          mandate: { commodities: ["cod"], maxPerUnit: "9800000" },
        })
      }),
    )
    const detail = await openHanse()
    fireEvent.click(await within(detail).findByRole("button", { name: "Edit" }))
    fireEvent.change(within(detail).getByLabelText("Max price per unit"), { target: { value: "9.80" } })
    fireEvent.click(within(detail).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(plain(detail.textContent)).toContain("cod up to €9.80 per unit"))
    expect(sent).toEqual({ mandate: { maxPerUnit: "9800000", avoidNoShowSellers: true } })
  })

  it("lists the purchase with its timeline, and a problem report that needs a photo", async () => {
    const detail = await openHanse()
    const buys = within(detail).getByRole("region", { name: "Purchases" })
    await waitFor(() => expect(buys).toHaveTextContent("Lot 12 · 600 kg cod from Ingrid Solheim · Sold"))
    expect(within(buys).getByRole("list", { name: "Lot timeline" })).toBeInTheDocument()
    fireEvent.click(within(buys).getByRole("button", { name: "Report a problem" }))
    expect(within(buys).getByRole("button", { name: "Send report" })).toBeDisabled()
  })

  it("offers Seller didn't come only after the pickup deadline", async () => {
    let sent: unknown
    server.use(
      http.post("*/api/noshow/report", async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ tx: TX, contestEnds: 1260 })
      }),
    )
    const detail = await openHanse()
    expect(
      await within(detail).findByText(/You can report a no-show after the pickup deadline, in \d+:\d\d\./),
    ).toBeInTheDocument()
    act(() => townStore.setState((s) => ({ town: { ...s.town, block: 1201 } })))
    fireEvent.click(await within(detail).findByRole("button", { name: "Seller didn't come" }))
    expect(await within(detail).findByRole("status")).toHaveTextContent(
      "Reported. The seller has until block 1260 to answer.",
    )
    expect(sent).toEqual({ buyerId: MOCK_HANSE, lotId: "12", tokenAmount: MOCK_LOT12_UNITS })
  })

  it("lists the families of a housing society", async () => {
    routed("/buy", <BuyPage />)
    fireEvent.click(await screen.findByRole("button", { name: /Shanti Niwas/ }))
    const families = await screen.findByRole("region", { name: "Families" })
    expect(families).toHaveTextContent("Flat 2B, Desai family · 20")
    expect(families).toHaveTextContent("Flat 7C, Iyer family · 10")
  })
})

describe("Watch in town", () => {
  it("opens the agent's panel when the town loads", async () => {
    routed(`/town?select=agent:${MOCK_HANSE}`, <TownPage />)
    await waitFor(() => expect(townStore.getState().selection).toEqual({ kind: "agent", id: MOCK_HANSE }))
  })
})
