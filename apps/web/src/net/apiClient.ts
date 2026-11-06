import { ApiError } from "@fairtown/shared/api"
import type { z } from "zod"
import { API_ROUTES, type ApiRoutes, type Route, type RouteKey } from "./routes"

/** A failed call to the agents API. `code` is the contract 11 error code, or one of ours below. */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ApiClientError"
  }
}

type BodyOf<R> = R extends { req: z.ZodType } ? { body: z.input<R["req"]> } : { body?: never }
export type CallArgs<R> = { params?: Record<string, string>; query?: Record<string, string> } & BodyOf<R>
export type ApiClient = {
  [K in RouteKey]: (args?: CallArgs<ApiRoutes[K]>) => Promise<z.output<ApiRoutes[K]["res"]>>
}

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")

function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new ApiClientError("bad_request", `missing path parameter ${name}`, 0)
    return encodeURIComponent(value)
  })
}

async function call(
  baseUrl: string,
  fetchImpl: typeof fetch,
  route: Route,
  args: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
  sellerToken?: () => string | undefined,
): Promise<unknown> {
  let body: string | undefined
  if (route.req) {
    const parsed = route.req.safeParse(args.body)
    if (!parsed.success) throw new ApiClientError("bad_request", issues(parsed.error), 0)
    body = JSON.stringify(parsed.data)
  }
  const query = args.query ? `?${new URLSearchParams(args.query).toString()}` : ""
  const url = `${baseUrl}${buildPath(route.path, args.params)}${query}`

  let res: Response
  try {
    const token = route.auth === "seller" ? sellerToken?.() : undefined
    const headers: Record<string, string> = {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }
    res = await fetchImpl(url, {
      method: route.method.toUpperCase(),
      ...(body === undefined ? {} : { body }),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    })
  } catch (error: unknown) {
    throw new ApiClientError("network", error instanceof Error ? error.message : "network error", 0)
  }

  const text = await res.text()
  let json: unknown
  try {
    json = text === "" ? undefined : JSON.parse(text)
  } catch {
    json = undefined
  }

  if (!res.ok) {
    const err = ApiError.safeParse(json)
    if (err.success) throw new ApiClientError(err.data.error.code, err.data.error.message, res.status)
    throw new ApiClientError(`http_${res.status}`, `HTTP ${res.status} from ${route.path}`, res.status)
  }
  const parsed = route.res.safeParse(json)
  if (!parsed.success) throw new ApiClientError("bad_response", `${route.path}: ${issues(parsed.error)}`, res.status)
  return parsed.data
}

/** Typed client for contract 11. Requests and responses are validated with the shared zod schemas. */
export function createApiClient(opts: { baseUrl: string; fetchImpl?: typeof fetch; sellerToken?: () => string | undefined }): ApiClient {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  const client: Record<string, (args?: object) => Promise<unknown>> = {}
  for (const [key, route] of Object.entries(API_ROUTES)) {
    client[key] = (args) => call(opts.baseUrl, fetchImpl, route, args, opts.sellerToken)
  }
  return client as ApiClient
}
