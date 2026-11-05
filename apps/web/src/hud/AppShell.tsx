import { QueryClientProvider } from "@tanstack/react-query"
import { Suspense } from "react"
import { NavLink, Outlet } from "react-router"
import { queryClient } from "../net/queryClient"
import { ModeBadge, TestMoneyBadge } from "./ModeBadge"

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
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="flex items-center gap-3 border-b border-slate-800 px-3 py-2">
          <span className="font-bold">Fairtown</span>
          <ModeBadge />
          <TestMoneyBadge />
          <nav className="ml-auto flex gap-3 text-sm text-slate-400">
            {LINKS.map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "text-white" : "")}>
                {label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="flex-1">
          <Suspense fallback={<p className="p-4">Loading…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </QueryClientProvider>
  )
}
