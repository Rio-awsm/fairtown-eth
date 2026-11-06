import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

// The replay fixture has one deliberate duplicate id; the town must apply each id once.
const dayIds = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => (JSON.parse(l) as { id: string }).id)
const uniqueIds = new Set(dayIds).size

test("mock town consumes 50 events in 10s", async ({ page }) => {
  await page.goto("/town?speed=20")
  await page.waitForFunction(() => (window.__TOWN__?.eventsApplied ?? 0) >= 50, null, { timeout: 10_000 })

  await expect(page.locator("#game-container canvas")).toBeVisible()
  await expect(page.getByText("REPLAY", { exact: true })).toBeVisible()
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__TOWN__?.sceneCommandsApplied ?? 0)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__TOWN__?.rejected)).toBe(0)
})

test("replays the whole day and applies each envelope id once", async ({ page }) => {
  expect(dayIds.length).toBe(uniqueIds + 1)
  await page.goto("/town?speed=50")
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 15_000 })
  const town = await page.evaluate(() => ({
    applied: window.__TOWN__?.eventsApplied,
    paid: window.__TOWN__?.state.lots["12"]?.status,
  }))
  expect(town).toEqual({ applied: uniqueIds, paid: "paid_in_full" })
})

test("the debug overlay logs reducer commands", async ({ page }) => {
  await page.goto("/town?debug=1&speed=50")
  await expect(page.getByText(/"kind":"placeStall"/).first()).toBeVisible({ timeout: 10_000 })
})
