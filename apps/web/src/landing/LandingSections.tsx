import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react"
import { Link } from "react-router"
import { Logo, Wordmark } from "./Logo"
import "./sections.css"

/** The three partners the landing features, each with the part of a deal it runs. */
export const PARTNERS = [
  {
    name: "Uniswap Foundation",
    site: "https://www.uniswapfoundation.org/",
    // Logo files come from each organisation's own site (see CREDITS.md). h is the display height
    // in hero units, set per logo so the three marks look the same size.
    logo: { src: "/partners/uniswap-foundation.svg", width: 149, height: 35, h: 30 },
    role: "The auction",
    body: "Every lot sells in a Uniswap Continuous Clearing Auction. Each block sets one public clearing price, the same for every bidder in that block.",
  },
  {
    name: "Chainlink",
    site: "https://chain.link/",
    logo: { src: "/partners/chainlink.svg", width: 143, height: 36, h: 26 },
    role: "The outside world",
    body: "CRE workflows bring in exchange rates, reference prices, weather and calendar signals, and rule on disputes.",
  },
  {
    name: "Hedera",
    site: "https://hedera.com/",
    logo: { src: "/partners/hedera.png", width: 300, height: 84, h: 32 },
    role: "Agents that pay",
    body: "Buyer agents pay per request for market intel over x402, settled on Hedera testnet, within per-agent spending caps.",
  },
] as const

/** Line icons for the ways in, drawn on a 24-unit grid. pathLength=1 lets CSS draw them in. */
const ICONS = {
  sell: (
    <>
      <path pathLength={1} d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z" />
      <path pathLength={1} d="M8 9.5h8M8 12.5h5" />
    </>
  ),
  buy: (
    <>
      <circle pathLength={1} cx="12" cy="12" r="7.5" />
      <circle pathLength={1} cx="12" cy="12" r="3" />
      <path pathLength={1} d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
    </>
  ),
  board: <path pathLength={1} d="M3.5 20h17M6.5 20v-6M11 20V8.5M15.5 20v-9M20 4.5l-5 4-4.5-2.5-6 4.5" />,
} satisfies Record<string, ReactNode>

/** The three ways into the market. Not a sequence, so no numbers. */
export const WAYS_IN = [
  {
    title: "Sell a lot",
    body: "Say what you have and the lowest price you'll take, by chat or voice. Part of the money arrives at the sale, the rest at handover.",
    cta: "Sell a lot",
    to: "/sell",
    icon: "sell",
  },
  {
    title: "Send a buyer agent",
    body: "Tell an agent what you want, where, and your price cap. It bids for you and never goes past the cap.",
    cta: "Create a buyer",
    to: "/buy",
    icon: "buy",
  },
  {
    title: "Watch every price",
    body: "Every lot, bid and cleared price lands on a public board that anyone can check.",
    cta: "Open the public board",
    to: "/board",
    icon: "board",
  },
] as const

const REPO = "https://github.com/Rio-awsm/fairtown-eth"

type FootLinkSpec = { label: string; to?: string; href?: string; external?: boolean }

/** The footer's link groups. App pages use the router; anchors and other sites use plain links. */
export const FOOT_GROUPS: { title: string; links: FootLinkSpec[] }[] = [
  {
    title: "Market",
    links: [
      { label: "Open the town", to: "/town" },
      { label: "Sell a lot", to: "/sell" },
      { label: "Create a buyer", to: "/buy" },
      { label: "Public board", to: "/board" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "How a deal works", href: "#how" },
      { label: "Source code", href: REPO, external: true },
    ],
  },
  {
    title: "Built with",
    links: PARTNERS.map((p) => ({ label: p.name, href: p.site, external: true })),
  },
]

/** A footer link: a router Link for app pages, or an anchor that says when it opens a new tab. */
function FootLink({ label, to, href, external }: FootLinkSpec) {
  if (to) return <Link to={to}>{label}</Link>
  if (!external) return <a href={href}>{label}</a>
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
      <svg className="lp-foot-ext" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" />
      </svg>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

const canObserve = () => typeof IntersectionObserver !== "undefined"
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

/** True once the element has scrolled into view; true at once without IntersectionObserver. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(() => !canObserve())
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true)
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

/**
 * Scroll reveals for every [data-reveal] inside the root. Content is visible by default: only when
 * the browser can observe and motion is allowed does the root opt in (data-anim="on") and hide
 * what has not been reached yet, so no-JS, old browsers and reduced motion all see everything.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root || !canObserve() || reducedMotion()) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          ;(e.target as HTMLElement).dataset.shown = "true"
          io.unobserve(e.target)
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    )
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el))
    root.dataset.anim = "on"
    return () => io.disconnect()
  }, [])
  return ref
}

/** Moves the partner cell's spotlight to the pointer. */
function spotlight(e: PointerEvent<HTMLElement>) {
  const box = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", `${String(e.clientX - box.left)}px`)
  e.currentTarget.style.setProperty("--my", `${String(e.clientY - box.top)}px`)
}

const delay = (i: number) => ({ "--d": `${String(i * 90)}ms` }) as CSSProperties

/** Everything below the hero: the featured partners, the ways in, the closing call and the footer. */
export function LandingSections() {
  const root = useReveal<HTMLDivElement>()
  const [wire, drawn] = useSeen<HTMLElement>()
  return (
    <div ref={root} className="lp">
      <section ref={wire} className="lp-partners" aria-labelledby="lp-featuring" data-drawn={drawn}>
        <div className="lp-partners-head" data-reveal>
          <h2 id="lp-featuring" className="lp-label">
            Featuring
          </h2>
          <p className="lp-lede">The parts of Fairtown you shouldn&apos;t have to take on trust.</p>
        </div>

        <div className="lp-strip" data-reveal style={delay(1)}>
          <div className="lp-wire-track" aria-hidden="true">
            <span className="lp-pulse" />
            <span className="lp-pulse lp-pulse-late" />
          </div>
          <ul className="lp-wire">
            {PARTNERS.map((p, i) => (
              <li key={p.name} className="lp-partner" style={{ "--i": i } as CSSProperties} onPointerMove={spotlight}>
                <span className="lp-node" aria-hidden="true" />
                <p className="lp-partner-name">{p.name}</p>
                <p className="lp-partner-role">{p.role}</p>
                <p className="lp-partner-body">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-ways" aria-labelledby="lp-ways-title">
        <div className="lp-ways-head" data-reveal>
          <h2 id="lp-ways-title" className="lp-h2">
            Three ways into the market
          </h2>
          <p className="lp-ways-sub">Pick the part you play. Each one opens its own page.</p>
        </div>
        <ul className="lp-ways-list">
          {WAYS_IN.map((w, i) => (
            <li key={w.title} className="lp-way" data-reveal style={delay(i)}>
              <svg className="lp-way-icon" viewBox="0 0 24 24" aria-hidden="true">
                {ICONS[w.icon]}
              </svg>
              <div className="lp-way-text">
                <h3 className="lp-way-title">{w.title}</h3>
                <p className="lp-way-body">{w.body}</p>
              </div>
              <Link to={w.to} className="lp-way-link">
                {w.cta}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Dawn: the closing call is the sky, the footer is the ground, and the horizon divides them. */}
      <div className="lp-dawn">
        <section className="lp-close" aria-labelledby="lp-close-title">
          <div className="lp-aurora" aria-hidden="true">
            <span className="lp-aurora-a" />
            <span className="lp-aurora-b" />
          </div>
          <div className="lp-close-inner" data-reveal>
            <h2 id="lp-close-title" className="lp-close-title">
              Watch a market day unfold
            </h2>
            <p className="lp-close-body">
              The town shows every lot, bid and handover as it happens. All money here is test money on testnets.
            </p>
            <div className="lp-close-ctas">
              <Link to="/town" className="landing-pill landing-pill-lime">
                Open the town
              </Link>
              <Link to="/sell" className="landing-pill lp-pill-glass">
                Sell a lot
              </Link>
            </div>
          </div>
        </section>

        <footer className="lp-foot">
          <div className="lp-horizon-wrap" aria-hidden="true">
            <span className="lp-horizon" />
          </div>
          <div className="lp-foot-inner">
            <div className="lp-foot-main" data-reveal>
              <div className="lp-foot-brand">
                <Logo className="lp-foot-mark" />
                <p className="lp-foot-note">
                  An open market for anything with an expiry date. AI agents bid, one clearing price per block, and the
                  money is released at handover.
                </p>
                <p className="lp-foot-status">Test money on testnets</p>
              </div>
              {FOOT_GROUPS.map((g) => (
                <nav key={g.title} className="lp-foot-group" aria-label={g.title}>
                  <p className="lp-foot-title" aria-hidden="true">
                    {g.title}
                  </p>
                  <ul>
                    {g.links.map((l) => (
                      <li key={l.label}>
                        <FootLink {...l} />
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <div className="lp-foot-bar">
              <p>Built at ETHGlobal Mumbai 2026.</p>
              <a href="#top" className="lp-foot-top">
                Back to top
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
                </svg>
              </a>
            </div>
            {/* The giant wordmark: the town's name lit by the dawn, rising out of the ground. */}
            <div className="lp-foot-giant" aria-hidden="true">
              <Wordmark />
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
