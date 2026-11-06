import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const CRYPTO = /\b(wallet|gas|token|crypto|blockchain)\b/i

async function check(page: Page, state: string) {
  const text = (await page.locator("body").innerText()).replace(/[\u00a0\u202f]/g, " ")
  expect(text, `crypto word on /sell (${state})`).not.toMatch(CRYPTO)
  const axe = await new AxeBuilder({ page }).analyze()
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `axe on /sell (${state})`,
  ).toEqual([])
}

test("a seller lists from a phone: pick, type, photo with lot code, draft, preview, confirm, payout, history", async ({
  page,
}) => {
  await page.goto("/sell?speed=50")
  await expect(page.getByRole("heading", { level: 1, name: "Sell" })).toBeVisible()
  await check(page, "picker")

  await page.getByRole("button", { name: /Ingrid Solheim/ }).tap()
  await page.getByRole("textbox", { name: "What are you selling?" }).fill("600 kg cod, landed 04:40, Bergen")

  await page.getByRole("button", { name: "Open camera" }).tap()
  await expect(page.getByText(/^Hold the code \d{4} in the photo$/)).toBeVisible()
  await page.getByRole("button", { name: "Take photo" }).tap()
  await expect(page.getByText("1 of 3 photos")).toBeVisible()
  await page.getByRole("button", { name: "Done" }).tap()
  await check(page, "composer")

  await page.getByRole("button", { name: "Send" }).tap()
  const preview = page.getByRole("status", { name: "What you will receive" })
  await expect(preview).toContainText("At least €2,227.50 at sale")
  await expect(preview).toContainText("and the rest at handover.")
  await expect(page.getByText("TEST MONEY").first()).toBeVisible()
  await check(page, "draft")

  // The mock replay at 50× has sold Lot 12 by now, so Confirm lands on the payout.
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })
  await page.getByRole("button", { name: "Confirm and start selling" }).tap()
  const payout = page.getByRole("region", { name: "Payout" })
  await expect(payout).toContainText("€2,702.70 received")
  await expect(payout).toContainText("€2,702.70 received at handover")
  await expect(page.getByRole("link", { name: "Receipt" })).toHaveAttribute(
    "href",
    /^https:\/\/sepolia\.basescan\.org\/tx\/0x/,
  )
  await check(page, "payout")

  await page.getByRole("tab", { name: "History" }).tap()
  await expect(page.getByRole("region", { name: "History" })).toContainText("Lot 12 · 600 kg cod · Paid in full")
  await check(page, "history")
})

test("the phone layout fits the screen without sideways scrolling", async ({ page }) => {
  await page.goto("/sell")
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
