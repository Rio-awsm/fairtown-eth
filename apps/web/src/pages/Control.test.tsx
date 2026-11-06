// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { handlers } from "../mocks/handlers"
import { ControlPage } from "./Control"

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const renderControl = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ControlPage />
    </QueryClientProvider>,
  )

describe("ControlPage", () => {
  it("shows API ok when the agents API is healthy", async () => {
    renderControl()
    expect(await screen.findByText("API ok")).toBeInTheDocument()
  })

  it("shows API down with the error code when health fails", async () => {
    server.use(http.get("*/api/health", () => new HttpResponse(null, { status: 503 })))
    renderControl()
    expect(await screen.findByText("API down (http_503)")).toBeInTheDocument()
  })
})
