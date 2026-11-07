// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"
import { FOOT_GROUPS, LandingSections, PARTNERS, WAYS_IN } from "./LandingSections"

const renderSections = () =>
  render(
    <MemoryRouter>
      <LandingSections />
    </MemoryRouter>,
  )
const featuring = () => screen.getByRole("region", { name: "Featuring" })
/** jsdom has no matchMedia: give it one that answers the reduced-motion query. */
const motion = (pref: "reduce" | "allow") =>
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: pref === "reduce" }) as MediaQueryList,
  })

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, "matchMedia")
})

describe("LandingSections", () => {
  it("features Uniswap Foundation, Chainlink and Hedera, in that order, each with its part", () => {
    renderSections()
    const rows = within(featuring()).getAllByRole("listitem")
    expect(rows.map((r) => r.querySelector(".lp-partner-name")!.textContent)).toEqual([
      "Uniswap Foundation",
      "Chainlink",
      "Hedera",
    ])
    expect(rows.every((r) => (r.querySelector(".lp-partner-body")?.textContent ?? "").length > 40)).toBe(true)
    expect(PARTNERS).toHaveLength(3)
  })

  it("offers three ways in, each linking to its page", () => {
    renderSections()
    const ways = screen.getByRole("region", { name: "Three ways into the market" })
    for (const w of WAYS_IN) {
      expect(within(ways).getByRole("heading", { level: 3, name: w.title })).toBeInTheDocument()
      expect(within(ways).getByRole("link", { name: w.cta })).toHaveAttribute("href", w.to)
    }
  })

  it("closes with the town and selling, and says the money is test money", () => {
    renderSections()
    const close = screen.getByRole("region", { name: "Watch a market day unfold" })
    expect(within(close).getByRole("link", { name: "Open the town" })).toHaveAttribute("href", "/town")
    expect(within(close).getByRole("link", { name: "Sell a lot" })).toHaveAttribute("href", "/sell")
    expect(within(close).getByText(/test money on testnets/)).toBeInTheDocument()
  })

  describe("footer", () => {
    const footer = () => screen.getByRole("contentinfo")
    const group = (name: string) => within(footer()).getByRole("navigation", { name })

    it("carries the wordmark, a test-money status and the giant name, all but the status decorative", () => {
      renderSections()
      expect(footer().querySelector("svg.lp-foot-mark")).toHaveAttribute("aria-hidden", "true")
      expect(footer().querySelector(".lp-foot-giant")).toHaveAttribute("aria-hidden", "true")
      expect(within(footer()).getByText("Test money on testnets")).toBeInTheDocument()
    })

    it("groups its links into Market, Learn and Built with, in that order", () => {
      renderSections()
      const names = within(footer())
        .getAllByRole("navigation")
        .map((n) => n.getAttribute("aria-label"))
      expect(names).toEqual(FOOT_GROUPS.map((g) => g.title))
      expect(names).toEqual(["Market", "Learn", "Built with"])
    })

    it("sends Market links to the app's pages through the router", () => {
      renderSections()
      const market = group("Market")
      expect(within(market).getByRole("link", { name: "Open the town" })).toHaveAttribute("href", "/town")
      expect(within(market).getByRole("link", { name: "Sell a lot" })).toHaveAttribute("href", "/sell")
      expect(within(market).getByRole("link", { name: "Create a buyer" })).toHaveAttribute("href", "/buy")
      expect(within(market).getByRole("link", { name: "Public board" })).toHaveAttribute("href", "/board")
    })

    it("keeps the deal anchor in this tab and opens the source code in a new one, saying so", () => {
      renderSections()
      const learn = group("Learn")
      const how = within(learn).getByRole("link", { name: "How a deal works" })
      expect(how).toHaveAttribute("href", "#how")
      expect(how).not.toHaveAttribute("target")
      const source = within(learn).getByRole("link", { name: "Source code (opens in a new tab)" })
      expect(source).toHaveAttribute("target", "_blank")
      expect(source).toHaveAttribute("rel", "noreferrer")
    })

    it("links each featured partner to its own site, in a new tab", () => {
      renderSections()
      const built = group("Built with")
      // The same sites the hero's logos link to, as the team gave them.
      expect(PARTNERS.map((p) => p.site)).toEqual([
        "https://www.uniswapfoundation.org/",
        "https://chain.link/",
        "https://hedera.com/",
      ])
      for (const { name, site: href } of PARTNERS) {
        const link = within(built).getByRole("link", { name: `${name} (opens in a new tab)` })
        expect(link).toHaveAttribute("href", href)
        expect(link).toHaveAttribute("target", "_blank")
        expect(link).toHaveAttribute("rel", "noreferrer")
      }
    })

    it("ends with where it was built and a way back to the top", () => {
      renderSections()
      expect(within(footer()).getByText("Built at ETHGlobal Mumbai 2026.")).toBeInTheDocument()
      expect(within(footer()).getByRole("link", { name: "Back to top" })).toHaveAttribute("href", "#top")
    })
  })

  it("draws the partner wire at once when the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined)
    renderSections()
    expect(featuring()).toHaveAttribute("data-drawn", "true")
  })

  it("without IntersectionObserver every section is shown at once, with no reveal hiding", () => {
    vi.stubGlobal("IntersectionObserver", undefined)
    const { container } = renderSections()
    expect(container.querySelector(".lp")).not.toHaveAttribute("data-anim")
  })

  it("with reduced motion nothing is hidden for a reveal", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    )
    motion("reduce")
    const { container } = renderSections()
    expect(container.querySelector(".lp")).not.toHaveAttribute("data-anim")
  })

  it("reveals each part once it scrolls into view, and stops watching it", () => {
    const observers: { cb: (e: Partial<IntersectionObserverEntry>[]) => void; unobserve: ReturnType<typeof vi.fn> }[] =
      []
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        unobserve = vi.fn()
        constructor(cb: (e: Partial<IntersectionObserverEntry>[]) => void) {
          observers.push({ cb, unobserve: this.unobserve })
        }
        observe() {}
        disconnect() {}
      },
    )
    motion("allow")
    const { container } = renderSections()
    const root = container.querySelector(".lp")!
    expect(root).toHaveAttribute("data-anim", "on")
    const row = container.querySelector(".lp-way")!
    expect(row).not.toHaveAttribute("data-shown")
    // The reveal observer is the one that unobserves; feed it an entry for the first row.
    const reveal = observers[0]!
    act(() => reveal.cb([{ isIntersecting: false, target: row }]))
    expect(row).not.toHaveAttribute("data-shown")
    act(() => reveal.cb([{ isIntersecting: true, target: row }]))
    expect(row).toHaveAttribute("data-shown", "true")
    expect(reveal.unobserve).toHaveBeenCalledWith(row)
  })

  it("keeps the wire undrawn until the section scrolls into view, then stops watching", () => {
    let fire: ((entries: Partial<IntersectionObserverEntry>[]) => void) | undefined
    const disconnect = vi.fn()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          fire = cb
        }
        observe() {}
        disconnect = disconnect
      },
    )
    renderSections()
    expect(featuring()).toHaveAttribute("data-drawn", "false")
    act(() => fire!([{ isIntersecting: false }]))
    expect(featuring()).toHaveAttribute("data-drawn", "false")
    act(() => fire!([{ isIntersecting: true }]))
    expect(featuring()).toHaveAttribute("data-drawn", "true")
    expect(disconnect).toHaveBeenCalled()
  })
})
