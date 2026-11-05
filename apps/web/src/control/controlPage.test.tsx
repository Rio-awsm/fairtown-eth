// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { handlers } from "../mocks/handlers"
import { ControlPage } from "../pages/Control"
import { CHANNEL } from "./channel"

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
const open: BroadcastChannel[] = []
afterEach(() => {
  server.resetHandlers()
  open.splice(0).forEach((c) => c.close())
})
afterAll(() => server.close())

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <ControlPage />
    </QueryClientProvider>,
  )

/** A pretend /town window on the same channel. */
function fakeTown(ui = { director: false, priceWeather: false, qr: true, clockFocus: false, muted: true }) {
  const got: unknown[] = []
  const channel = new BroadcastChannel(CHANNEL)
  open.push(channel)
  channel.onmessage = (e) => {
    got.push(e.data)
    if (e.data?.type === "hello") channel.postMessage({ type: "state", ui, speed: 1 })
  }
  return got
}

describe("/control scenarios", () => {
  it("starts a scenario at the chosen speed", async () => {
    let sent: unknown
    server.use(
      http.post("*/api/director/scenario", async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ started: true })
      }),
    )
    wrap()
    fireEvent.change(screen.getByLabelText("Scenario speed"), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "Start bergen_cod" }))
    expect(await screen.findByText("Started bergen_cod at 20×")).toBeInTheDocument()
    expect(sent).toEqual({ name: "bergen_cod", speed: 20 })
  })

  it("offers every scenario", () => {
    wrap()
    for (const name of [
      "bergen_cod",
      "dallas_return",
      "gpu_night",
      "diwali_marigold",
      "rose_flight",
      "lagos_cold",
      "no_show",
      "full_day",
    ])
      expect(screen.getByRole("button", { name: `Start ${name}` })).toBeInTheDocument()
  })

  it("shows the director's status", async () => {
    server.use(
      http.get("*/api/director/status", () => HttpResponse.json({ scenario: "no_show", step: "contest window" })),
    )
    wrap()
    expect(await screen.findByText("Running no_show · contest window")).toBeInTheDocument()
  })

  it("explains a failed start in plain words", async () => {
    server.use(
      http.post("*/api/director/scenario", () =>
        HttpResponse.json({ error: { code: "busy", message: "x" } }, { status: 409 }),
      ),
    )
    wrap()
    fireEvent.click(screen.getByRole("button", { name: "Start full_day" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not start full_day. Is the agents service running?",
    )
  })
})

describe("/control town controls", () => {
  it("finds the town window and shows its state", async () => {
    fakeTown()
    wrap()
    expect(await screen.findByText("Town window connected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Join QR" })).toHaveAttribute("aria-pressed", "true")
  })

  it("says how to connect when no town window answers", () => {
    wrap()
    expect(screen.getByText("Open /town in another window on this computer.")).toBeInTheDocument()
  })

  it("sends director, weather, QR, clock focus, sound, jump and speed", async () => {
    const got = fakeTown()
    wrap()
    await screen.findByText("Town window connected")
    const town = screen.getByRole("region", { name: "Town" })
    fireEvent.click(within(town).getByRole("button", { name: "Camera director" }))
    fireEvent.click(within(town).getByRole("button", { name: "Price weather" }))
    fireEvent.click(within(town).getByRole("button", { name: "Join QR" }))
    fireEvent.click(within(town).getByRole("button", { name: "World clock focus" }))
    fireEvent.click(within(town).getByRole("button", { name: "Sound" }))
    fireEvent.click(within(town).getByRole("button", { name: "Jump to Flower Hall · Mumbai · Nairobi to Amsterdam" }))
    fireEvent.change(within(town).getByLabelText("Replay speed"), { target: { value: "50" } })
    await waitFor(() =>
      expect(got.filter((m) => (m as { type: string }).type !== "hello")).toEqual([
        { type: "director", on: true },
        { type: "priceWeather", on: true },
        { type: "qr", on: false },
        { type: "clockFocus", on: true },
        { type: "mute", on: false },
        { type: "jump", building: "flower_hall" },
        { type: "speed", speed: 50 },
      ]),
    )
  })
})
