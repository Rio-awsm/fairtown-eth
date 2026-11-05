import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

type Envelope = { id: string; event: { type: string; lotId?: string } }
const day: Envelope[] = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Envelope)
const STORM = day.find((e) => e.event.type === "lot.listed" && e.event.lotId === "12")!.id
const mapReady = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.map.status === "ready", null, { timeout: 15_000 })
const replayDone = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })

test("demo mode keeps LIVE or REPLAY and TEST MONEY on screen", async ({ page }) => {
  for (const path of ["/town?demo=1", "/board?demo=1", "/sell?demo=1"]) {
    await page.goto(path)
    await expect(page.getByText("REPLAY", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("TEST MONEY", { exact: true }).first()).toBeVisible()
  }
})

test("demo mode baseline at the storm", async ({ page }) => {
  await page.goto(`/town?demo=1&speed=50&until=${STORM}`)
  await replayDone(page)
  // The camera director is on in demo mode; turn it off so the camera rests on the whole town.
  await page.keyboard.press("d")
  await page.waitForTimeout(1500)
  await page.addStyleTag({ content: "[data-hud] { visibility: hidden !important; }" })
  await expect(page.locator("#game-container canvas")).toHaveScreenshot("demo-storm.png", { maxDiffPixelRatio: 0.01 })
})

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  test(`town, board and control fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    for (const path of ["/town", "/board", "/control"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${path} sideways scroll`).toBeLessThanOrEqual(0)
    }
    await page.goto("/town")
    await mapReady(page)
    await page.keyboard.press("1")
    const hud = await page.getByRole("list", { name: "World clock" }).boundingBox()
    const panel = await page.getByRole("complementary", { name: "Details" }).boundingBox()
    expect(hud && panel && hud.x + hud.width <= panel.x, "world clock and detail panel overlap").toBe(true)
  })
}

test("/control drives a town window on the same computer", async ({ page, context }) => {
  await page.goto("/town?speed=50")
  await mapReady(page)
  const control = await context.newPage()
  await control.goto("/control")
  await expect(control.getByText("Town window connected")).toBeVisible()
  const town = control.getByRole("region", { name: "Town" })
  await town.getByRole("button", { name: "World clock focus" }).click()
  await town.getByRole("button", { name: "Camera director" }).click()
  await town.getByRole("button", { name: "Price weather" }).click()
  await page.waitForFunction(() => {
    const ui = window.__TOWN__!.ui
    return ui.clockFocus && ui.director && ui.priceWeather
  })
  await expect(page.getByRole("list", { name: "Price weather legend" })).toBeVisible()
  await expect(town.getByRole("button", { name: "Camera director" })).toHaveAttribute("aria-pressed", "true")
  await town.getByRole("button", { name: "Join QR" }).click()
  await expect(page.getByRole("img", { name: "Scan to join and bid" })).toHaveCount(0)
})
