// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { routes } from "./App"

vi.mock("./game/PhaserGame", () => ({ PhaserGame: () => <div data-testid="phaser" /> }))

const PAGES = [
  ["/town", "Town"],
  ["/sell", "Sell"],
  ["/scan", "Handover"],
  ["/buy", "Buyer console"],
  ["/walkin", "Walk in"],
  ["/board", "Public board"],
  ["/control", "Control"],
] as const

const CRYPTO_WORDS = /\b(wallet|gas|token|crypto|blockchain)\b/i

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe("routes", () => {
  it.each(PAGES)("%s shows its heading, the mode badge and TEST MONEY", async (path, heading) => {
    renderAt(path)
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getByText("TEST MONEY")).toBeInTheDocument()
    expect(screen.getByText(/^(LIVE|REPLAY)$/)).toBeInTheDocument()
  })

  it("redirects / to /town", async () => {
    const router = renderAt("/")
    expect(await screen.findByRole("heading", { level: 1, name: "Town" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/town")
  })

  it.each(["/sell", "/scan", "/walkin"])("%s uses no crypto words", async (path) => {
    renderAt(path)
    await screen.findByRole("heading", { level: 1 })
    expect(document.body.textContent).not.toMatch(CRYPTO_WORDS)
  })
})
