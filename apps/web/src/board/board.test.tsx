// @vitest-environment jsdom
import type { TownEnvelope, TownEvent } from "@fairtown/shared/protocol"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockLedger, type LedgerClient } from "../arkiv/ledger"
import { EventBus } from "../game/EventBus"
import { PriceWeatherToggle } from "../hud/PriceWeatherToggle"
import { BoardPage } from "../pages/Board"
import { createTownStore, townStore } from "../state/townStore"
import { SAMPLE_EVENTS as S, SELLER } from "../test/samples"

const DAY = 86_400_000
const COASTAL = "0x00000000000000000000000000000000000000c0"
let seq = 0
const env = (event: TownEvent, day = 20_398): TownEnvelope => ({
  v: 1,
  id: `b-${++seq}`,
  ts: day * DAY + seq,
  source: "chain",
  event,
})

/** Cod sold twice in Bergen, haddock once, and Coastal Catch's no-show on the record. */
function seedTown() {
  const store = createTownStore(EventBus)
  const events: TownEnvelope[] = [
    env(S["lot.listed"], 20_380),
    env({ ...S["lot.settled"], avgPerUnit: "8000000" }, 20_380),
    env({ ...S["lot.listed"], lotId: "60", commodity: "haddock", seller: COASTAL, sellerName: "Coastal Catch" }),
    env({ ...S["lot.settled"], lotId: "60", avgPerUnit: "5500000", finalClearingPerUnit: "5500000" }),
    env({ ...S["lot.listed"], lotId: "61" }),
    env({ ...S["lot.settled"], lotId: "61", avgPerUnit: "9600000", finalClearingPerUnit: "9500000" }),
    env({ ...S["seller.record"], seller: SELLER, cleanLots: 1, noShows: 0, proven: false }),
    env({ ...S["seller.record"], seller: COASTAL, cleanLots: 0, noShows: 1, proven: false }),
  ]
  for (const e of events) store.getState().applyEnvelope(e)
  const { town, ledger } = store.getState()
  act(() => townStore.setState({ town: { ...town, block: 1000 }, ledger, selection: null }))
}

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
const mock = () => createMockLedger(() => townStore.getState().ledger)
const plain = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ")

beforeEach(seedTown)
afterEach(() => vi.restoreAllMocks())

describe("/board", () => {
  it("labels the ledger as mock", () => {
    wrap(<BoardPage client={mock()} />)
    expect(screen.getByText("MOCK LEDGER")).toBeInTheDocument()
  })

  it("lists the latest clears with final and average price", async () => {
    wrap(<BoardPage client={mock()} />)
    const clears = screen.getByRole("table", { name: "Latest clears" })
    await waitFor(() => expect(within(clears).getAllByRole("row")).toHaveLength(4))
    expect(plain(clears.textContent)).toContain("Lot 61")
    expect(plain(clears.textContent)).toContain("€9.50")
    expect(plain(clears.textContent)).toContain("€9.60")
  })

  it("shows each seller's latest record: tier, clean lots and no-shows", async () => {
    wrap(<BoardPage client={mock()} />)
    const records = screen.getByRole("table", { name: "Seller records" })
    const coastal = await within(records).findByRole("row", { name: /Coastal Catch/ })
    expect(
      within(coastal)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Coastal Catch", "New", "0", "1"])
  })

  it("shows the real query text and its results, and both change together", async () => {
    wrap(<BoardPage client={mock()} />)
    const box = screen.getByRole("region", { name: "Query the ledger" })
    expect(within(box).getByLabelText("Query text")).toHaveTextContent(
      "arkiv.schema = str('fairtown.v1.price') AND commodity = str('cod') ORDER BY day:u64 DESC",
    )
    await waitFor(() =>
      expect(within(box).getByRole("table", { name: "Query results" }).querySelectorAll("tbody tr")).toHaveLength(2),
    )
    fireEvent.change(within(box).getByLabelText("Commodity"), { target: { value: "haddock" } })
    expect(within(box).getByLabelText("Query text")).toHaveTextContent("commodity = str('haddock')")
    await waitFor(() =>
      expect(within(box).getByRole("table", { name: "Query results" }).querySelectorAll("tbody tr")).toHaveLength(1),
    )
  })

  it("runs the seller record preset", async () => {
    wrap(<BoardPage client={mock()} />)
    const box = screen.getByRole("region", { name: "Query the ledger" })
    fireEvent.click(within(box).getByRole("button", { name: "Coastal Catch's record" }))
    expect(within(box).getByLabelText("Query text")).toHaveTextContent(`seller = str('${COASTAL}')`)
    await waitFor(() => expect(within(box).getByRole("table", { name: "Query results" })).toHaveTextContent("noShows"))
  })

  it("shows price weather for each market against its own average", async () => {
    wrap(<BoardPage client={mock()} />)
    const weather = screen.getByRole("region", { name: "Price weather" })
    await waitFor(() => expect(weather).toHaveTextContent("Fish Dock · Bergen"))
    expect(plain(weather.textContent)).toContain("Fish Dock · Bergen · codDearer than usual€9.60 vs 30-day €8.80")
    expect(plain(weather.textContent)).toContain("Fish Dock · Bergen · haddockUsual price€5.50 vs 30-day €5.50")
  })

  it("says so in plain words when the ledger cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const broken: LedgerClient = { mode: "live", run: () => Promise.reject(new Error("429 rate limited")) }
    wrap(<BoardPage client={broken} />)
    expect(await screen.findAllByText("We could not reach the ledger just now. Retrying.")).not.toHaveLength(0)
    expect(screen.getByText("LIVE LEDGER · Arkiv Rabdi")).toBeInTheDocument()
  })
})

describe("price weather toggle", () => {
  it("tints the town's buildings by band and clears them when turned off", async () => {
    const seen: unknown[] = []
    const off = EventBus.on("priceWeather", (w) => seen.push(w))
    wrap(<PriceWeatherToggle client={mock()} />)
    fireEvent.click(screen.getByRole("button", { name: "Price weather" }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ fish_dock: expect.any(String) }))
    expect(screen.getByRole("list", { name: "Price weather legend" })).toHaveTextContent("Much cheaper than usual")
    fireEvent.click(screen.getByRole("button", { name: "Price weather" }))
    expect(seen.at(-1)).toBeNull()
    off()
  })
})
