import { expect, test } from "@playwright/test"

test("production build renders the town without the __TOWN__ test hook", async ({ page }) => {
  await page.goto("/town")
  await expect(page.locator("#game-container canvas")).toBeVisible()
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => "__TOWN__" in window)).toBe(false)
})

test("a deep route survives a refresh in the production build", async ({ page }) => {
  await page.goto("/sell")
  await page.reload()
  await expect(page.getByRole("heading", { level: 1, name: "Sell" })).toBeVisible()
})
