import { expect, test } from "@playwright/test"

const PAGES = [
  ["/town", "Town"],
  ["/sell", "Sell"],
  ["/scan", "Handover"],
  ["/buy", "Buyer console"],
  ["/walkin", "Walk in"],
  ["/board", "Public board"],
  ["/control", "Control"],
] as const

for (const [path, heading] of PAGES) {
  test(`${path} shows its heading, REPLAY and TEST MONEY`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeAttached()
    await expect(page.getByText("REPLAY", { exact: true })).toBeVisible()
    await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()
  })
}

test("/control reaches the mock API through the MSW service worker", async ({ page }) => {
  await page.goto("/control")
  await expect(page.getByText("API ok")).toBeVisible()
})

test("/ redirects to /town", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/town$/)
})
