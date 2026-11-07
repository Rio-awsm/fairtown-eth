// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"
import { townStore } from "../state/townStore"
import { CLIP_DESKTOP, LandingPage, POSTER } from "./LandingPage"

const loaded = (c: HTMLElement) => c.querySelector(".landing")!.getAttribute("data-loaded")

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState(null, "", "/")
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("LandingPage", () => {
  it("tells Fairtown's story: nav, headline and scroll cue, with no subline", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("One Fair Pricefor Every Harvest")
    expect(screen.getByRole("link", { name: "Fairtown" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "HOW A DEAL WORKS" })).toHaveAttribute("href", "#how")
    expect(screen.getByRole("link", { name: "PUBLIC BOARD" })).toHaveAttribute("href", "/board")
    expect(screen.getByRole("link", { name: "SELL A LOT" })).toHaveAttribute("href", "/sell")
    expect(screen.getByRole("link", { name: "OPEN THE TOWN" })).toHaveAttribute("href", "/town")
    expect(screen.getByText("SCROLL TO SEE HOW A DEAL WORKS")).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NORVA|Staffing|crews/i)
  })

  it("shows REPLAY or LIVE from the town, and TEST MONEY", () => {
    townStore.setState({ mode: "replay" })
    const { unmount } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(screen.getByText("REPLAY")).toBeInTheDocument()
    expect(screen.getByText("TEST MONEY")).toBeInTheDocument()
    unmount()
    townStore.setState({ mode: "live" })
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(screen.getByText("LIVE")).toBeInTheDocument()
  })

  it("lists the four deal steps, each with a paragraph, 01 open", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    const rows = within(container.querySelector("ol")!).getAllByRole("listitem")
    expect(rows.map((r) => r.querySelector(".landing-step-title")!.textContent)).toEqual([
      "List it in plain words",
      "Agents bid within caps",
      "One fair price for all",
      "Paid at the handover",
    ])
    expect(rows[0]).toHaveAttribute("aria-current", "step")
    expect(rows[1]).not.toHaveAttribute("aria-current")
    expect(rows.every((r) => (r.querySelector(".landing-step-body")?.textContent ?? "").length > 40)).toBe(true)
  })

  it("plays the desktop clip over its poster, muted and inline", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    const video = container.querySelector("video")!
    expect(video.getAttribute("src")).toBe(CLIP_DESKTOP)
    expect(video.getAttribute("poster")).toBe(POSTER)
    expect(video.muted).toBe(true)
    expect(video.hasAttribute("playsinline")).toBe(true)
  })

  it("the loader shows the Fairtown mark, word and a loading bar, and stays a labelled status", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    const loader = screen.getByRole("status", { name: "Loading" })
    expect(loader.querySelector("svg.landing-loader-mark")).toHaveAttribute("aria-hidden", "true")
    expect(loader.querySelector("svg.landing-loader-word")).toHaveAttribute("aria-hidden", "true")
    expect(loader.querySelector(".landing-loader-bar")).not.toBeNull()
    // The old cyan-squares mark is gone.
    expect(container.querySelector(".landing-loader-ring")).toBeNull()
  })

  it("once loaded the loader leaves the accessibility tree", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    act(() => vi.advanceTimersByTime(3500))
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull()
  })

  it("the loader fades 350 ms after the clip's first frame", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
    expect(loaded(container)).toBe("false")
    fireEvent(container.querySelector("video")!, new Event("loadeddata"))
    act(() => vi.advanceTimersByTime(349))
    expect(loaded(container)).toBe("false")
    act(() => vi.advanceTimersByTime(1))
    expect(loaded(container)).toBe("true")
  })

  it("the loader still goes after 3.5 s when the clip never arrives", () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    act(() => vi.advanceTimersByTime(3499))
    expect(loaded(container)).toBe("false")
    act(() => vi.advanceTimersByTime(1))
    expect(loaded(container)).toBe("true")
  })

  it("recorder mode drops the loader and exposes __recTime, which returns the clip time", () => {
    window.history.replaceState(null, "", "/?rec=1")
    const pause = vi.fn()
    const animation = { pause, play: vi.fn(), cancel: vi.fn(), playState: "paused", currentTime: 0 }
    HTMLElement.prototype.animate = vi.fn(() => animation as unknown as Animation)
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    const { container, unmount } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull()
    const video = container.querySelector("video")!
    Object.defineProperty(video, "duration", { value: 5.04 })
    expect(window.__recTime!(video, 0.2)).toBe(0)
    expect(window.__recTime!(video, 0.55 + 5.04)).toBeCloseTo(5.04 - 1 / 48)
    expect(video.currentTime).toBeCloseTo(5.04 - 1 / 48)
    expect(pause).toHaveBeenCalled()
    unmount()
    expect(window.__recTime).toBeUndefined()
  })

  it("features the three partners' logos under the headline, each linking to its own site in a new tab", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(document.body.textContent).not.toMatch(/AI agents bid\. One clearing price\./)
    const row = document.querySelector<HTMLElement>(".landing-hero .landing-logos")!
    const links = within(row).getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://www.uniswapfoundation.org/",
      "https://chain.link/",
      "https://hedera.com/",
    ])
    for (const [i, name] of ["Uniswap Foundation", "Chainlink", "Hedera"].entries()) {
      const link = links[i]!
      expect(link).toHaveAccessibleName(`${name} (opens in a new tab)`)
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noreferrer")
      // Each logo is a real image with its name as alt text, sized up front so nothing shifts.
      const img = within(link).getByRole("img", { name })
      expect(img.getAttribute("src")).toMatch(/^\/partners\//)
      expect(img).toHaveAttribute("width")
      expect(img).toHaveAttribute("height")
    }
    expect(within(row.parentElement!).getByText("Featuring")).toBeInTheDocument()
  })

  it("continues past the hero into the featured partners", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    const featuring = screen.getByRole("region", { name: "Featuring" })
    for (const name of ["Uniswap Foundation", "Chainlink", "Hedera"]) {
      expect(within(featuring).getByText(name)).toBeInTheDocument()
    }
    // The deal steps live inside the sticky scene, so they leave with the clip.
    expect(document.querySelector(".landing-scene .landing-steps")).not.toBeNull()
  })

  it("without ?rec=1 there is no recorder hook", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(window.__recTime).toBeUndefined()
  })
})
