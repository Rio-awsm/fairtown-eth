import { http, HttpResponse, type HttpHandler } from "msw"
import { API_ROUTES, type Route, type RouteKey } from "../net/routes"
import { MOCK_RESPONSES } from "./responses"

const badRequest = (message: string) => HttpResponse.json({ error: { code: "bad_request", message } }, { status: 400 })

function handlerFor(key: RouteKey, route: Route): HttpHandler {
  // "*" prefix: match any origin, so the same handlers serve the browser (same origin) and Node tests.
  return http[route.method](`*${route.path}`, async ({ request }) => {
    if (route.req) {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return badRequest("body is not JSON")
      }
      const parsed = route.req.safeParse(body)
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid body")
    }
    return HttpResponse.json(MOCK_RESPONSES[key] as object)
  })
}

/** `VITE_API_URL=mock` (contract 13): one handler per contract 11 route. */
export const handlers: HttpHandler[] = (Object.entries(API_ROUTES) as [RouteKey, Route][]).map(([key, route]) =>
  handlerFor(key, route),
)
