import { lazy } from "react"
import { Navigate, type RouteObject } from "react-router"
import { AppShell } from "./hud/AppShell"
import { BoardPage } from "./pages/Board"
import { BuyPage } from "./pages/Buy"
import { ControlPage } from "./pages/Control"
import { ScanPage } from "./pages/Scan"
import { SellPage } from "./pages/Sell"
import { WalkinPage } from "./pages/Walkin"

// Lazy, so phones on /sell, /scan and /walkin never download Phaser.
const TownPage = lazy(() => import("./pages/Town").then((m) => ({ default: m.TownPage })))

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/town" replace /> },
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
