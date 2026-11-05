import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router"
import { routes } from "./App"
import { env } from "./config"
import { connectTown } from "./state/connectTown"
import { exposeTown } from "./state/exposeTown"
import { townStore } from "./state/townStore"
import "./index.css"

async function startMockApi() {
  const { worker } = await import("./mocks/browser")
  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      // Assets and the relay pass through; an unmocked /api call is a missing handler.
      if (new URL(request.url).pathname.startsWith("/api/")) print.error()
    },
  })
}

async function boot(root: HTMLElement) {
  if (env.api.mode === "mock") await startMockApi()
  // Outside React, so StrictMode's double effects never open a second relay connection.
  const params = new URLSearchParams(window.location.search)
  const speed = Number(params.get("speed")) || 1
  // ?relay=off (outside production) draws the bare map, for the screenshot baseline.
  const relayOff = env.exposeTown && params.get("relay") === "off"
  // ?until=<envelope id> (outside production) stops the replay there, for the effect baselines.
  const until = (env.exposeTown && params.get("until")) || undefined
  if (!relayOff) connectTown(env, townStore, { speed, ...(until ? { until } : {}) }).start()
  exposeTown(window, townStore, env.exposeTown)
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={createBrowserRouter(routes)} />
    </StrictMode>,
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("index.html is missing #root")
boot(root).catch((error: unknown) => {
  console.error("Fairtown failed to start", error)
  root.textContent = "Fairtown failed to start. See the browser console."
})
