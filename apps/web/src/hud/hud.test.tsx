// @vitest-environment jsdom
import type { TownEvent } from "@fairtown/shared/protocol"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import type { ReactNode } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { initialTownState, reduce, type TownState } from "../game/reducer"
import { handlers } from "../mocks/handlers"
import { townStore } from "../state/townStore"
import { BUYER, SAMPLE_EVENTS as S, SELLER, TRUCK, TX } from "../test/samples"
import { AgentPanel } from "./AgentPanel"
import { BuildingPanel } from "./BuildingPanel"
import { MemoryRouter } from "react-router"
import { HudLayer } from "./HudLayer"
import { LotJourney } from "./LotJourney"
import { LotPanel } from "./LotPanel"
import { Ticker } from "./Ticker"
import { Timeline } from "./Timeline"
import { TopBar } from "./TopBar"
import { TownLegend } from "./TownLegend"
import { WorldClock } from "./WorldClock"

vi.mock("./PriceChart", () => ({ PriceChart: () => <div data-testid="price-chart" /> }))

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const run = (events: TownEvent[], from: TownState = initialTownState) =>
  events.reduce((s, e) => reduce(s, e).state, from)
const EXPLORER = "https://sepolia.basescan.org"
const FIXTURE_START = Date.UTC(2026, 10, 6, 4, 0)

const bergen = () =>
  run([
    S["lot.listed"],
    S["agent.spawned"],
    { ...S["agent.spawned"], agentId: TRUCK, name: "Lars", role: "TRUCK", building: "freight_yard" },
    S["agent.intent"],
    S["bid.placed"],
    S["price.tick"],
    S["lot.settled"],
    {
      ...S["lot.listed"],
      lotId: "20",
      building: "freight_yard",
      sector: "truck",
      commodity: "truck_capacity",
      unit: "kg_route",
      parentLotId: "12",
    },
    S["reference.updated"],
    { ...S["seller.record"], proven: false, cleanLots: 1 },
  ])

const seed = (town: TownState) =>
  act(() =>
    townStore.setState({
      town: { ...town, block: 1050 },
      ts: FIXTURE_START,
      selection: null,
      ticker: [],
      mode: "replay",
      status: "replay",
    }),
  )

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => seed(bergen()))

describe("TopBar", () => {
  it("shows block, relay status, REPLAY and TEST MONEY, and no signal chips", () => {
    seed(run([S.signal], bergen()))
    wrap(<TopBar />)
    expect(screen.getByText("Block 1050")).toBeInTheDocument()
    // Signals show in the town itself (weather over the market) and in the ticker, not as chips here.
    expect(screen.queryByText("Storm forecast")).toBeNull()
    expect(screen.getByText("replay")).toBeInTheDocument()
    expect(screen.getByText("REPLAY")).toBeInTheDocument()
    expect(screen.getByText("TEST MONEY")).toBeInTheDocument()
  })
})

describe("Day/Night toggle", () => {
  afterEach(() => {
    act(() => townStore.getState().setUi({ daylight: "night" }))
    window.localStorage.removeItem("fairtown.daylight")
  })
  it("starts at night, switches to day and back, and remembers the choice", () => {
    wrap(<TopBar />)
    const toggle = screen.getByRole("button", { name: "Daylight" })
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(toggle).toHaveTextContent("Night")
    fireEvent.click(toggle)
    expect(townStore.getState().ui.daylight).toBe("day")
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    expect(toggle).toHaveTextContent("Day")
    expect(window.localStorage.getItem("fairtown.daylight")).toBe("day")
    fireEvent.click(toggle)
    expect(townStore.getState().ui.daylight).toBe("night")
  })
  it("keeps REPLAY and TEST MONEY on screen by day", () => {
    wrap(<TopBar />)
    fireEvent.click(screen.getByRole("button", { name: "Daylight" }))
    expect(screen.getByText("REPLAY")).toBeInTheDocument()
    expect(screen.getByText("TEST MONEY")).toBeInTheDocument()
  })
  it("N switches too", () => {
    wrap(<HudLayer />)
    fireEvent.keyDown(window, { key: "n" })
    expect(townStore.getState().ui.daylight).toBe("day")
  })
})

describe("LotJourney", () => {
  it("follows the newest live lot with its steps, in words", () => {
    wrap(<LotJourney />)
    const strip = screen.getByRole("region", { name: "Lot journey" })
    // Lot 20 (a truck lot, still open) is newer than sold Lot 12.
    expect(strip).toHaveTextContent("Lot 20")
    expect(strip).toHaveTextContent("600 kg moved truck capacity")
    expect(strip).toHaveTextContent("Freight Yard")
    expect(within(strip).getByText("Auction").closest("li")).toHaveAttribute("aria-current", "step")
    fireEvent.click(within(strip).getByRole("button"))
    expect(townStore.getState().selection).toEqual({ kind: "lot", id: "20" })
  })
  it("follows the selected lot instead", () => {
    act(() => townStore.getState().select({ kind: "lot", id: "12" }))
    wrap(<LotJourney />)
    const strip = screen.getByRole("region", { name: "Lot journey" })
    expect(strip).toHaveTextContent("Lot 12")
    expect(within(strip).getByText("Truck").closest("li")).toHaveAttribute("data-state", "current")
  })
  it("shows nothing before any lot is listed", () => {
    seed(initialTownState)
    const { container } = wrap(<LotJourney />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("TownLegend", () => {
  it("starts folded, and says what each colour means when opened", () => {
    wrap(<TownLegend />)
    const key = screen.getByRole("complementary", { name: "Legend" })
    const toggle = within(key).getByRole("button", { name: "Key" })
    // Folded at first, so the town stays clear.
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(key).not.toHaveTextContent("AI buyer")
    fireEvent.click(toggle)
    for (const word of ["AI buyer", "Seller", "Driver", "Walk-in", "Auction open", "Truck route"])
      expect(key).toHaveTextContent(word)
    fireEvent.click(toggle)
    expect(key).not.toHaveTextContent("AI buyer")
  })
  it("steps aside while a detail panel is open", () => {
    act(() => townStore.getState().select({ kind: "building", id: "fish_dock" }))
    wrap(<HudLayer />)
    expect(screen.queryByRole("complementary", { name: "Legend" })).toBeNull()
    act(() => townStore.getState().select(null))
  })
})

describe("WorldClock", () => {
  it("shows Bergen, Dallas, Mumbai and the data centre with local time and the next expiry", () => {
    seed({ ...bergen(), lots: { ...bergen().lots, "12": { ...bergen().lots["12"]!, status: "open", endBlock: 1095 } } })
    wrap(<WorldClock />)
    const rows = screen.getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Bergen05:00"),
      expect.stringContaining("Dallas22:00"),
      expect.stringContaining("Mumbai09:30"),
      expect.stringContaining("Data centre04:00"),
    ])
    expect(rows[0]).toHaveTextContent("Lot 12 ends in 1:30")
    // A city with nothing open shows only its name and time.
    expect(rows[1]).toHaveTextContent(/^Dallas22:00$/)
  })
})

describe("Timeline", () => {
  const states = (lotEvents: TownEvent[]) => {
    const lot = run(lotEvents, run([S["lot.listed"]])).lots["12"]!
    wrap(<Timeline lot={lot} block={1050} />)
    return screen.getAllByRole("listitem").map((li) => li.getAttribute("data-state"))
  }

  it("shows the five steps pending while the auction is open", () => {
    expect(states([])).toEqual(["pending", "pending", "pending", "pending", "pending"])
  })

  it("shows Sold done and Truck booked current after the sale, with the deadline", () => {
    expect(states([S["lot.settled"]])).toEqual(["done", "current", "pending", "pending", "pending"])
    expect(screen.getByText(/deadline in/)).toBeInTheDocument()
  })

  it("links each done step's tx to the explorer", () => {
    states([S["lot.settled"]])
    expect(screen.getByRole("link", { name: /0xabab…abab/ })).toHaveAttribute("href", `${EXPLORER}/tx/${TX}`)
  })

  it("shows every step done when paid in full", () => {
    expect(
      states([
        S["lot.settled"],
        S["carrier.assigned"],
        S["handover.confirmed"],
        S["lot.delivered"],
        S["lot.paid_in_full"],
      ]),
    ).toEqual(["done", "done", "done", "done", "done"])
  })

  it("shows the red Refunded branch after a no-show", () => {
    states([S["lot.settled"], S["noshow.reported"], S["noshow.refunded"]])
    expect(screen.getByRole("status")).toHaveTextContent("Refunded: seller did not hand over")
  })

  it("flags a reported no-show", () => {
    states([S["lot.settled"], S["noshow.reported"]])
    expect(screen.getByText("No-show reported")).toBeInTheDocument()
  })
})

describe("Ticker", () => {
  it("lists recent lines, newest first", () => {
    act(() =>
      townStore.setState({
        ticker: [
          { id: "b", text: "Hanse Kitchen bid €9.40/kg on Lot 12" },
          { id: "a", text: "Lot 12 listed" },
        ],
      }),
    )
    wrap(<Ticker />)
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Hanse Kitchen bid €9.40/kg on Lot 12",
      "Lot 12 listed",
    ])
  })
})

describe("LotPanel", () => {
  it("shows clearing, average paid, bids with tx links, payout split and seller tier", async () => {
    wrap(<LotPanel lotId="12" />)
    expect(screen.getByRole("heading", { name: "Lot 12 · 600 kg cod" })).toBeInTheDocument()
    expect(screen.getByText("€9.00/kg")).toHaveAttribute("title", expect.stringContaining("lot.settled"))
    expect(screen.getByText("€9.10/kg")).toBeInTheDocument()
    expect(screen.getByText("New")).toBeInTheDocument()
    const bids = screen.getByRole("table", { name: "Bids" })
    expect(within(bids).getByRole("button", { name: "Hanse Kitchen" })).toBeInTheDocument()
    expect(within(bids).getByRole("link")).toHaveAttribute("href", `${EXPLORER}/tx/${TX}`)
    const payout = screen.getByRole("region", { name: "Payout" })
    expect(payout).toHaveTextContent("Seller now€2,702.70")
    expect(payout).toHaveTextContent("Held until handover€2,702.70")
    expect(payout).toHaveTextContent("Fee€54.60")
    expect(payout).toHaveTextContent("Advance50%")
    expect(screen.getByTestId("price-chart")).toBeInTheDocument()
    expect(await screen.findByText("Verified")).toBeInTheDocument()
  })

  it("shows no verified badge unless tee_verified is true", async () => {
    server.use(
      http.get("*/api/lots/:lotId", () =>
        HttpResponse.json({
          spec: {},
          status: "open",
          bids: [],
          gradeReport: { grade: "fresh_a", tee_verified: "yes" },
        }),
      ),
    )
    wrap(<LotPanel lotId="12" />)
    expect(await screen.findByText(/fresh_a/)).toBeInTheDocument()
    expect(screen.queryByText("Verified")).not.toBeInTheDocument()
  })

  it("still shows relay data when the API is down", async () => {
    server.use(http.get("*/api/lots/:lotId", () => new HttpResponse(null, { status: 503 })))
    wrap(<LotPanel lotId="12" />)
    expect(await screen.findByText(/Grade report unavailable/)).toBeInTheDocument()
    expect(screen.getByText("€9.10/kg")).toBeInTheDocument()
  })

  it("links parent and child lots", () => {
    wrap(<LotPanel lotId="12" />)
    fireEvent.click(screen.getByRole("button", { name: "Lot 20" }))
    expect(townStore.getState().selection).toEqual({ kind: "lot", id: "20" })
  })

  it("opens the bidder's agent panel", () => {
    wrap(<LotPanel lotId="12" />)
    fireEvent.click(screen.getByRole("button", { name: "Hanse Kitchen" }))
    expect(townStore.getState().selection).toEqual({ kind: "agent", id: BUYER })
  })

  it("shows the next deadline only while the lot still has one", () => {
    seed(run([S["carrier.assigned"], S["handover.confirmed"], S["lot.delivered"], S["lot.paid_in_full"]], bergen()))
    wrap(<LotPanel lotId="12" />)
    expect(screen.queryByText("Next deadline")).not.toBeInTheDocument()
  })

  it("shows the pickup deadline after the sale", () => {
    wrap(<LotPanel lotId="12" />)
    expect(screen.getByText("Next deadline")).toBeInTheDocument()
  })

  it("says so when the lot is unknown", () => {
    wrap(<LotPanel lotId="99" />)
    expect(screen.getByText("Lot 99 has not been seen yet.")).toBeInTheDocument()
  })
})

describe("AgentPanel", () => {
  it("shows persona, mandate, budget, reasons and a wallet link", async () => {
    wrap(<AgentPanel agentId={BUYER} />)
    expect(screen.getByRole("heading", { name: "Hanse Kitchen" })).toBeInTheDocument()
    expect(screen.getByText("Grade A cod, storm tomorrow, capping at €9.40/kg")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /0x0000…00b2/ })).toHaveAttribute("href", `${EXPLORER}/address/${BUYER}`)
    expect(await screen.findByText("Hamburg restaurant group buying fresh fish")).toBeInTheDocument()
    expect(screen.getByText("cod, haddock up to €9.40 per unit")).toBeInTheDocument()
    expect(screen.getByText("€50,000.00")).toBeInTheDocument()
  })
})

describe("BuildingPanel", () => {
  it("lists open lots, clears and the reference", () => {
    wrap(<BuildingPanel building="fish_dock" />)
    expect(screen.getByRole("heading", { name: "Fish Dock · Bergen" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Recent clears" })).toHaveTextContent("Lot 12")
    expect(screen.getByRole("region", { name: "Reference" })).toHaveTextContent("cod €8.30")
    fireEvent.click(
      within(screen.getByRole("region", { name: "Recent clears" })).getByRole("button", { name: /Lot 12/ }),
    )
    expect(townStore.getState().selection).toEqual({ kind: "lot", id: "12" })
  })
})

describe("HudLayer keyboard", () => {
  it("opens buildings with 1 to 7 and closes with Esc", () => {
    wrap(<HudLayer />)
    fireEvent.keyDown(window, { key: "1" })
    expect(screen.getByRole("heading", { name: "Fish Dock · Bergen" })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: "7" })
    expect(townStore.getState().selection).toEqual({ kind: "building", id: "compute_yard" })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(townStore.getState().selection).toBeNull()
    fireEvent.keyDown(window, { key: "8" })
    expect(townStore.getState().selection).toBeNull()
  })
})

void SELLER
