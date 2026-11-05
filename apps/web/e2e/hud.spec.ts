import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

const EXPLORER = "https://sepolia.basescan.org"
type Envelope = { id: string; event: { type: string; lotId?: string } }
const day: Envelope[] = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Envelope)
const lot12Listed = day.find((e) => e.event.type === "lot.listed" && e.event.lotId === "12")!.id

test("world clock, ticker and top bar during the replay", async ({ page }) => {
  await page.goto("/town?speed=50")
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })
  const clock = page.getByRole("list", { name: "World clock" })
  await expect(clock.getByRole("listitem")).toHaveCount(4)
  for (const city of ["Bergen", "Dallas", "Mumbai", "Data centre"]) await expect(clock).toContainText(city)
  await expect(page.getByRole("list", { name: "Ticker" })).toContainText(
    "walked into town|Coastal Catch|refunded|Quiet dock|reference".split("|")[3]!,
  )
  await expect(page.getByText(/^Block \d+$/)).toBeVisible()
  await expect(page.getByText("REPLAY", { exact: true })).toBeVisible()
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()
})

test("keys open a building, then a lot, then its bidder; every tx links to the explorer; Esc closes", async ({
  page,
}) => {
  await page.goto("/town?speed=50")
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })
  await page.keyboard.press("1")
  const panel = page.getByRole("complementary", { name: "Details" })
  await expect(panel.getByRole("heading", { name: "Fish Dock · Bergen" })).toBeVisible()
  await panel
    .getByRole("region", { name: "Recent clears" })
    .getByRole("button", { name: /Lot 12/ })
    .click()
  await expect(panel.getByRole("heading", { name: "Lot 12 · 600 kg cod" })).toBeVisible()
  await expect(panel.getByRole("region", { name: "Payout" })).toContainText("€2,702.70")
  const txLinks = panel.getByRole("link")
  expect(await txLinks.count()).toBeGreaterThan(1)
  for (const href of await txLinks.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
    expect(href).toMatch(new RegExp(`^${EXPLORER}/tx/0x[0-9a-f]{64}$`))
  }
  await expect(panel.getByRole("list", { name: "Lot timeline" }).getByRole("listitem")).toHaveCount(5)
  await panel.getByRole("table", { name: "Bids" }).getByRole("button", { name: "Hanse Kitchen" }).first().click()
  await expect(panel.getByRole("heading", { name: "Hanse Kitchen" })).toBeVisible()
  await expect(panel.getByRole("link")).toHaveAttribute("href", new RegExp(`^${EXPLORER}/address/0x[0-9a-f]{40}$`))
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
})

test("clicking a stall in the town opens its lot panel", async ({ page }) => {
  await page.goto(`/town?speed=50&until=${lot12Listed}`)
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })
  await page.waitForFunction(() => window.__TOWN__!.stallsOnScreen.some((s) => s.lotId === "12"))
  const stall = await page.evaluate(() => window.__TOWN__!.stallsOnScreen.find((s) => s.lotId === "12")!)
  const box = (await page.locator("#game-container canvas").boundingBox())!
  await page.mouse.click(box.x + (stall.x * box.width) / 1920, box.y + (stall.y * box.height) / 1080)
  await expect(page.getByRole("heading", { name: "Lot 12 · 600 kg cod" })).toBeVisible()
})
