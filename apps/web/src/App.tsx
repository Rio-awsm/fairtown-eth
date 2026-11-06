import { lazy } from "react"
import type { RouteObject } from "react-router"
import { BuyPage } from "./pages/Buy"
import { ControlPage } from "./pages/Control"
import { ScanPage } from "./pages/Scan"
import { SellPage } from "./pages/Sell"
import { WalkinPage } from "./pages/Walkin"
import { LandingPage } from "./landing/LandingPage"
import { SiteShell } from "./landing/SiteShell"

// Lazy, so phones on /sell, /scan and /walkin never download the 3D town.
const TownPage = lazy(() => import("./pages/Town").then((m) => ({ default: m.TownPage })))
// Lazy too: the board pulls in the Arkiv SDK, which phone pages never need.
const BoardPage = lazy(() => import("./pages/Board").then((m) => ({ default: m.BoardPage })))

export const routes: RouteObject[] = [
  // The landing hero: full-screen, with its own nav, outside the app shell.
  { index: true, element: <LandingPage /> },
  // Every app page in the landing's look, with its top bar (D-43).
  {
    element: <SiteShell />,
    children: [
      { path: "town", element: <TownPage /> },
      { path: "sell", element: <SellPage /> },
      { path: "scan", element: <ScanPage /> },
      { path: "buy", element: <BuyPage /> },
      { path: "walkin", element: <WalkinPage /> },
      { path: "board", element: <BoardPage /> },
      { path: "control", element: <ControlPage /> },
    ],
  },
]
