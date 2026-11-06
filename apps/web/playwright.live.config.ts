import { defineConfig, devices } from "@playwright/test"

// C 1.2: the town against the real local stack. `pnpm e2e:town-live` starts the anvil fork, keeper, agents, relay and
// this app on WEB_PORT, then runs this config; nothing here starts a server.
const GPU = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : []

export default defineConfig({
  testDir: "e2e-live",
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:8080",
    launchOptions: { args: GPU },
    trace: "retain-on-failure",
  },
})
