import "@fontsource-variable/inter-tight"
import { Link, NavLink } from "react-router"
import { useTown } from "../state/townStore"
import { Logo } from "./Logo"
import "./landing.css"

type Props = {
  /** "overlay" floats over the landing's clip; "solid" is a sticky night bar for the other pages. */
  variant?: "overlay" | "solid"
  /** Where "How a deal works" points: an anchor on the landing, the landing's anchor elsewhere. */
  howHref?: string
}

/** The Fairtown top bar from the landing: LIVE or REPLAY, TEST MONEY, links, wordmark, two pills. */
export function SiteNav({ variant = "overlay", howHref = "/#how" }: Props) {
  const live = useTown((s) => s.mode) === "live"
  return (
    <header className={`landing-nav ${variant === "solid" ? "landing-nav-solid" : ""}`}>
      <div className="landing-nav-left">
        {/* Every Fairtown page says whether it is live or a replay, and that the money is test money. */}
        <span className={`landing-badge ${live ? "landing-badge-live" : ""}`}>{live ? "LIVE" : "REPLAY"}</span>
        <span className="landing-badge landing-badge-test">TEST MONEY</span>
        <nav className="landing-links" aria-label="Fairtown">
          <a href={howHref}>HOW A DEAL WORKS</a>
          <NavLink to="/board">PUBLIC BOARD</NavLink>
        </nav>
      </div>
      <Link to="/" className="landing-wordmark" aria-label="Fairtown">
        <Logo />
      </Link>
      <div className="landing-nav-right">
        <Link to="/sell" className="landing-pill landing-pill-grey">
          SELL A LOT
        </Link>
        <Link to="/town" className="landing-pill landing-pill-lime">
          OPEN THE TOWN
        </Link>
      </div>
    </header>
  )
}
