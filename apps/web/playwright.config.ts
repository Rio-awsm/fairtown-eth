import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"
import { writeQrVideo } from "./e2e/qr-video"
import { MOCK_HANSE, MOCK_LOT12_UNITS, mockQrText, mockTicket } from "./src/mocks/ticket"

// The scanner phone's fake camera films the exact code the seller phone shows for Lot 12.
const QR_VIDEO = fileURLToPath(new URL("./e2e/.generated/lot12-code.y4m", import.meta.url))
writeQrVideo(mockQrText(mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS)), QR_VIDEO)

const MOCKS = { VITE_RELAY_URL: "mock", VITE_API_URL: "mock", PUBLIC_WEB_URL: "https://fairtown.example" }
const viewport = { width: 1920, height: 1080 }

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    {
      // iPhone 13 screen and touch in Chromium: only Chromium can fake a camera for getUserMedia.
      name: "mobile",
      testMatch: /(sell|walkin)\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        baseURL: "http://localhost:8081",
        permissions: ["camera", "microphone", "geolocation"],
        geolocation: { latitude: 60.39, longitude: 5.32 },
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
    {
      // Two phones in one browser: the camera is a fake video of the seller's QR code.
      name: "scan",
      testMatch: /handover\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        baseURL: "http://localhost:8081",
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-video-capture=${QR_VIDEO}`,
          ],
        },
      },
    },
    {
      // Desktop buyer console with a fake camera for dispute photos.
      name: "buy",
      testMatch: /buy\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        baseURL: "http://localhost:8081",
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
    {
      name: "dev",
      testIgnore: /(prod|sell|handover|buy|walkin)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport, baseURL: "http://localhost:8081" },
    },
    {
      name: "prod",
      testMatch: /prod\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport, baseURL: "http://localhost:8082" },
    },
  ],
  webServer: [
    {
      command: "pnpm exec vite --port 8081 --strictPort",
      url: "http://localhost:8081/town",
      env: MOCKS,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "pnpm exec vite build --outDir dist-e2e --emptyOutDir && pnpm exec vite preview --outDir dist-e2e --port 8082 --strictPort",
      url: "http://localhost:8082/town",
      env: MOCKS,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
