// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"
import { townStore } from "../state/townStore"
import { SiteNav } from "./SiteNav"

const at = (path: string, ui: React.ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

describe("SiteNav", () => {
  it("carries REPLAY or LIVE, TEST MONEY, the links and the two pills", () => {
    townStore.setState({ mode: "replay" })
    at("/board", <SiteNav variant="solid" />)
    expect(screen.getByText("REPLAY")).toBeInTheDocument()
    expect(screen.getByText("TEST MONEY")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "HOW A DEAL WORKS" })).toHaveAttribute("href", "/#how")
    expect(screen.getByRole("link", { name: "SELL A LOT" })).toHaveAttribute("href", "/sell")
    expect(screen.getByRole("link", { name: "OPEN THE TOWN" })).toHaveAttribute("href", "/town")
  })

  it("marks the page you are on", () => {
    at("/board", <SiteNav variant="solid" />)
    expect(screen.getByRole("link", { name: "PUBLIC BOARD" })).toHaveAttribute("aria-current", "page")
  })

  it("is a sticky solid bar on pages, and floats over the clip on the landing", () => {
    const { container, unmount } = at("/board", <SiteNav variant="solid" />)
    expect(container.querySelector("header")).toHaveClass("landing-nav-solid")
    unmount()
    const landing = at("/", <SiteNav howHref="#how" />)
    expect(landing.container.querySelector("header")).not.toHaveClass("landing-nav-solid")
    expect(screen.getByRole("link", { name: "HOW A DEAL WORKS" })).toHaveAttribute("href", "#how")
    expect(screen.getByRole("link", { name: "PUBLIC BOARD" })).not.toHaveAttribute("aria-current")
  })

  it("says LIVE when the town is live", () => {
    townStore.setState({ mode: "live" })
    at("/board", <SiteNav variant="solid" />)
    expect(screen.getByText("LIVE")).toBeInTheDocument()
    townStore.setState({ mode: "replay" })
  })
})
