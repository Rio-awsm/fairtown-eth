import { http, HttpResponse, type HttpHandler } from "msw"
import { API_ROUTES, type Route, type RouteKey } from "../net/routes"
import { MOCK_RESPONSES } from "./responses"
import { mockAgent, mockAgentList, mockCreateBuyer, mockPatchAgent } from "./agents"
import { mockFallbackUrl, mockQrText, mockTicket } from "./ticket"

type Params = Record<string, string | readonly string[] | undefined>
const param = (params: Params, name: string) => String(params[name] ?? "")

/** Routes whose mock answer depends on the request or on mock state. Everything else returns MOCK_RESPONSES. */
const DYNAMIC: Partial<Record<RouteKey, (body: unknown, params: Params) => unknown>> = {
  agents: () => mockAgentList(),
  agent: (_, params) => mockAgent(param(params, "agentId")),
  createBuyer: (body) => mockCreateBuyer(body as Parameters<typeof mockCreateBuyer>[0]),
  patchAgent: (body, params) => mockPatchAgent(param(params, "agentId"), body as Parameters<typeof mockPatchAgent>[1]),
  handoverTicket: (body) => {
    const { lotId, buyer, tokenAmount } = body as { lotId: string; buyer: string; tokenAmount: string }
    const ticket = mockTicket(lotId, buyer, tokenAmount)
    const qrText = mockQrText(ticket)
    return { ticket, qrText, fallbackUrl: mockFallbackUrl(qrText) }
  },
}

const badRequest = (message: string) => HttpResponse.json({ error: { code: "bad_request", message } }, { status: 400 })

function handlerFor(key: RouteKey, route: Route): HttpHandler {
  // "*" prefix: match any origin, so the same handlers serve the browser (same origin) and Node tests.
  return http[route.method](`*${route.path}`, async ({ request, params }) => {
    if (route.req) {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return badRequest("body is not JSON")
      }
      const parsed = route.req.safeParse(body)
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid body")
      const dynamic = DYNAMIC[key]
      if (dynamic) return HttpResponse.json(dynamic(parsed.data, params) as object)
    }
    const dynamic = DYNAMIC[key]
    if (dynamic) return HttpResponse.json(dynamic(undefined, params) as object)
    return HttpResponse.json(MOCK_RESPONSES[key] as object)
  })
}

/** `VITE_API_URL=mock` (contract 13): one handler per contract 11 route. */
export const handlers: HttpHandler[] = (Object.entries(API_ROUTES) as [RouteKey, Route][]).map(([key, route]) =>
  handlerFor(key, route),
)
