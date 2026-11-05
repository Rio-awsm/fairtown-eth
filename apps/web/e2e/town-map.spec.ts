import { expect, test, type Page } from "@playwright/test"

// Baselines judge the town canvas only. The HUD is DOM over it (its clock reads real time with the relay
// off), and a mask on the zero-size [data-hud] wrapper hides nothing, so hide the HUD before each shot.
const SHOT_OPTS = { maxDiffPixelRatio: 0.01 }
const hideHud = (page: Page) => page.addStyleTag({ content: "[data-hud] { visibility: hidden !important; }" })

const mapStatus = (page: Page) => page.evaluate(() => window.__TOWN__?.map)
const waitForMap = (page: Page) =>
  page.waitForFunction(
    () => {
      const status = window.__TOWN__?.map.status
      return status === "ready" || status === "error"
    },
    null,
    { timeout: 10_000 },
  )
const nextFrames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

test("the Tiled town loads with all seven buildings and no problems", async ({ page }) => {
  await page.goto("/town?relay=off")
  await waitForMap(page)
  expect(await mapStatus(page)).toEqual({ status: "ready", buildings: 7, problems: [] })
})

test("town map screenshot baseline", async ({ page }) => {
  await page.goto("/town?relay=off")
  await waitForMap(page)
  await nextFrames(page)
  await hideHud(page)
  await expect(page.locator("#game-container canvas")).toHaveScreenshot("town-map.png", SHOT_OPTS)
})

// MSW's service worker makes the request, so route at the context, which also sees service worker traffic.
test("a broken map falls back to the stub layout, names the problem, and the replay still runs", async ({ page }) => {
  await page.context().route("**/assets/maps/town.tmj", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ width: 1, height: 1, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] }),
    }),
  )
  await page.goto("/town?speed=50")
  await waitForMap(page)
  const map = await mapStatus(page)
  expect(map?.status).toBe("error")
  expect(map?.problems).toContain("missing tile layer ground")
  await page.waitForFunction(() => (window.__TOWN__?.sceneCommandsApplied ?? 0) > 0, null, { timeout: 10_000 })
})

test("a missing map file falls back instead of crashing", async ({ page }) => {
  await page.context().route("**/assets/maps/town.tmj", (route) => route.fulfill({ status: 404, body: "" }))
  await page.goto("/town?relay=off")
  await waitForMap(page)
  expect((await mapStatus(page))?.status).toBe("error")
  await expect(page.locator("#game-container canvas")).toBeVisible()
})
