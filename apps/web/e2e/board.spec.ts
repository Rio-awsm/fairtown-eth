import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const ready = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })

test("the board shows clears, seller records and a live query over the mock ledger", async ({ page }) => {
  await page.goto("/board?speed=50")
  await ready(page)
  await expect(page.getByText("MOCK LEDGER")).toBeVisible()

  const clears = page.getByRole("table", { name: "Latest clears" })
  await expect(clears.locator("tbody tr")).toHaveCount(6)
  await expect(clears).toContainText("Lot 60")

  const coastal = page.getByRole("table", { name: "Seller records" }).getByRole("row", { name: /Coastal Catch/ })
  await expect(coastal.getByRole("cell")).toHaveText(["Coastal Catch", "New", "0", "1"])

  const box = page.getByRole("region", { name: "Query the ledger" })
  await expect(box.getByLabel("Query text")).toHaveText(
    "arkiv.schema = str('fairtown.v1.price') AND commodity = str('cod') ORDER BY day:u64 DESC",
  )
  await expect(box.getByRole("table", { name: "Query results" }).locator("tbody tr")).toHaveCount(1)
  await box.getByRole("button", { name: "Coastal Catch's record" }).click()
  await expect(box.getByLabel("Query text")).toContainText(
    "arkiv.schema = str('fairtown.v1.reputation') AND seller = str('0x",
  )
  await expect(box.getByRole("table", { name: "Query results" })).toContainText("noShows")

  await expect(page.getByRole("region", { name: "Price weather" })).toContainText("Fish Dock · Bergen")
  await expect(page.getByRole("img", { name: "Scan to join and bid" })).toBeVisible()

  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([])
})

test("price weather tints the town and shows a legend", async ({ page }) => {
  await page.goto("/town?speed=50")
  await ready(page)
  await page.getByRole("button", { name: "Price weather" }).click()
  await expect(page.getByRole("list", { name: "Price weather legend" })).toContainText("Much dearer than usual")
  await page.waitForFunction(() => (window.__TOWN__?.effectsSeen.priceWeather ?? 0) > 0)
})
