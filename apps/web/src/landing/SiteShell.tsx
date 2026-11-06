import { QueryClientProvider } from "@tanstack/react-query"
import { Suspense } from "react"
import { Outlet, useLocation } from "react-router"
import { queryClient } from "../net/queryClient"
import "../styles/night.css"
import { SiteNav } from "./SiteNav"

/**
 * Every app page in the landing's look (D-113): the night ground, Inter Tight, the night skin over
 * the page's own markup, and the Fairtown top bar with LIVE or REPLAY and TEST MONEY. /town is
 * full screen and carries the same bar in its HUD instead.
 */
export function SiteShell() {
  const fullScreen = useLocation().pathname === "/town"
  return (
    <QueryClientProvider client={queryClient}>
      <div className="ft-site ft-skin">
        {!fullScreen && <SiteNav variant="solid" />}
        <main>
          <Suspense fallback={<p className="ft-loading">Loading…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </QueryClientProvider>
  )
}
