import { http, HttpResponse } from "msw"
import { MOCK_RESPONSES } from "../mocks/responses"
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

describe("seller session header (ICR-009)", () => {
  const ok = () =>
    vi.fn(async () => new Response(JSON.stringify(MOCK_RESPONSES.handoverTicket), { status: 200 })) as unknown as typeof fetch
  const body = { sellerId: "ingrid", lotId: "12", buyer: `0x${"1".repeat(40)}`, tokenAmount: "1" }
  const headersOf = (f: typeof fetch) => new Headers((vi.mocked(f).mock.calls[0]![1] as RequestInit).headers)

  it("sends the session as a Bearer token on seller routes", async () => {
    const fetchImpl = ok()
    const local = createApiClient({ baseUrl: "http://api.test", fetchImpl, sellerToken: () => "s3cret" })
    await local.handoverTicket({ body })
    expect(headersOf(fetchImpl).get("authorization")).toBe("Bearer s3cret")
  })

  it("sends no Authorization without a session, or on other routes", async () => {
    const none = ok()
    await createApiClient({ baseUrl: "http://api.test", fetchImpl: none, sellerToken: () => undefined }).handoverTicket({ body })
    expect(headersOf(none).get("authorization")).toBeNull()
    const health = vi.fn(async () => new Response(JSON.stringify(MOCK_RESPONSES.health), { status: 200 })) as unknown as typeof fetch
    await createApiClient({ baseUrl: "http://api.test", fetchImpl: health, sellerToken: () => "s3cret" }).health()
    expect(new Headers((vi.mocked(health).mock.calls[0]![1] as RequestInit).headers).get("authorization")).toBeNull()
  })
})
