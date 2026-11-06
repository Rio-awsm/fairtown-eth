import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { handlers } from "../mocks/handlers"
import { ApiClientError, createApiClient } from "./apiClient"

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const api = createApiClient({ baseUrl: "http://api.test" })
const failure = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiClientError)
  return error as ApiClientError
}

describe("createApiClient", () => {
  it("turns a contract error body into ApiClientError with code and status", async () => {
    server.use(
      http.get("*/api/lots/:lotId", () =>
        HttpResponse.json({ error: { code: "lot_not_found", message: "No lot 99" } }, { status: 404 }),
      ),
    )
    const e = await failure(api.lot({ params: { lotId: "99" } }))
    expect(e).toMatchObject({ code: "lot_not_found", status: 404, message: "No lot 99" })
  })

  it("reports an unreadable error body as http_<status>", async () => {
    server.use(http.get("*/api/health", () => new HttpResponse("<html>oops</html>", { status: 500 })))
    expect(await failure(api.health())).toMatchObject({ code: "http_500", status: 500 })
  })

  it("rejects a 200 whose body breaks the shared schema", async () => {
    server.use(http.get("*/api/health", () => HttpResponse.json({ ok: "yes" })))
    expect(await failure(api.health())).toMatchObject({ code: "bad_response" })
  })

  it("reports a network failure", async () => {
    server.use(http.get("*/api/health", () => HttpResponse.error()))
    expect(await failure(api.health())).toMatchObject({ code: "network", status: 0 })
  })

  it("rejects an invalid request body before calling fetch", async () => {
    const fetchImpl = vi.fn()
    const local = createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await failure(local.draftListing({ body: { sellerId: "ingrid" } }))).toMatchObject({ code: "bad_request" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a missing path parameter before calling fetch", async () => {
    expect(await failure(api.lot())).toMatchObject({ code: "bad_request" })
  })

  it("encodes path parameters", async () => {
    let seen = ""
    server.use(
      http.get("*/api/sellers/:sellerId", ({ params }) => {
        seen = String(params.sellerId)
        return HttpResponse.json({ tier: "new", lots: [], payouts: [] })
      }),
    )
    await api.seller({ params: { sellerId: "a/b c" } })
    expect(seen).toBe("a/b c")
  })

  it("sends the JSON body for a POST", async () => {
    const ticket = await api.walkin({ body: { name: "Priya" } })
    expect(ticket.token).toBeTruthy()
  })
})
