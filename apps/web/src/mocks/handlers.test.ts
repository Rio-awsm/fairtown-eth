import { setupServer } from "msw/node"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApiClient } from "../net/apiClient"
import { API_ROUTES } from "../net/routes"
import { handlers } from "./handlers"
import { MOCK_RESPONSES } from "./responses"

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterAll(() => server.close())

const api = createApiClient({ baseUrl: "http://api.test" })
const KEYS = Object.keys(API_ROUTES) as (keyof typeof API_ROUTES)[]

describe("MSW handlers for contract 11", () => {
  it("covers all 26 routes", () => {
    expect(KEYS).toHaveLength(26)
    expect(handlers).toHaveLength(26)
    expect(Object.keys(MOCK_RESPONSES).sort()).toEqual([...KEYS].sort())
  })

  it.each(KEYS)("%s mock response parses with its shared schema", (key) => {
    expect(API_ROUTES[key].res.safeParse(MOCK_RESPONSES[key]).success).toBe(true)
  })

  it("answers health through the typed client", async () => {
    expect((await api.health()).ok).toBe(true)
  })

  it("answers the five-step timeline for Lot 12", async () => {
    const { steps } = await api.lotTimeline({ params: { lotId: "12" } })
    expect(steps.map((s) => s.name)).toEqual(["Sold", "Truck booked", "Picked up", "Delivered", "Paid in full"])
  })

  it("answers a reference query with its query string", async () => {
    const ref = await api.reference({ query: { commodity: "cod", market: "fish_dock" } })
    expect(ref.perUnit).toBe("8300000")
  })

  it("rejects a malformed request body with a contract error", async () => {
    const res = await fetch("http://api.test/api/walkin", { method: "POST", body: JSON.stringify({ name: "" }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: "bad_request" } })
  })
})
