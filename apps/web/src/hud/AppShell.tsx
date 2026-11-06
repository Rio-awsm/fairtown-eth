import { QueryClientProvider } from "@tanstack/react-query"
import { Suspense } from "react"
import { NavLink, Outlet, useLocation } from "react-router"
import { queryClient } from "../net/queryClient"
import { ModeBadge, TestMoneyBadge } from "./ModeBadge"
import { TownMark } from "./TownMark"

const LINKS = [
  ["/town", "Town"],
  ["/sell", "Sell"],
  ["/scan", "Scan"],
  ["/buy", "Buy"],
  ["/walkin", "Walk in"],
  ["/board", "Board"],
  ["/control", "Control"],
] as const

/** Every route shows LIVE or REPLAY and TEST MONEY (golden rule 8). */
export function AppShell() {
  // /town is a full-screen 1920 × 1080 view; its HUD top bar carries the badges there.
  const fullScreen = useLocation().pathname === "/town"
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col text-ink">
        {!fullScreen && (
          <header className="rpg-planks relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
            <span className="flex items-center gap-2 font-display text-xl font-bold text-parchment-light [text-shadow:0_2px_0_rgb(42_31_51/0.7)]">
              <TownMark />
              Fairtown
            </span>
            <ModeBadge />
            <TestMoneyBadge />
            <nav aria-label="Pages" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 py-1 sm:ml-auto">
              {LINKS.map(([to, label]) => (
                <NavLink key={to} to={to} className="rpg-tab">
                  {label}
                </NavLink>
              ))}
            </nav>
          </header>
        )}
        <main className="flex-1">
          <Suspense fallback={<p className="rpg-note m-4">Loading…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </QueryClientProvider>
  )
}
