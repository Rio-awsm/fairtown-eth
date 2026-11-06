import { readFileSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

type Envelope = { id: string; event: { type: string; phase?: string; lotId?: string } }
const day: Envelope[] = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Envelope)
// The clock jump after Lot 60 sold: Coastal Catch's pickup deadline has passed, no no-show reported yet.
const lot60Settled = day.findIndex((e) => e.event.type === "lot.settled" && e.event.lotId === "60")
const PAST_DEADLINE = day.slice(lot60Settled).find((e) => e.event.type === "clock" && !e.event.phase)!.id

const ready = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })
async function axe(page: Page, state: string) {
  const r = await new AxeBuilder({ page }).analyze()
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `axe (${state})`,
  ).toEqual([])
}

test("create a buyer agent, then pause it", async ({ page }) => {
  await page.goto("/buy?speed=50")
  await page.getByRole("button", { name: "New buyer" }).click()
  const form = page.getByRole("form", { name: "New buyer" })
  await axe(page, "create form")
  await form.getByLabel("Name").fill("Oslo Fish Bar")
  await form.getByLabel("cod", { exact: true }).check()
  await form.getByLabel("Max price per unit").fill("9.40")
  await form.getByLabel("Quantity").fill("100")
  await form.getByLabel("Budget").fill("2000")
  await form.getByRole("button", { name: "Create buyer" }).click()

  const detail = page.getByRole("region", { name: "Oslo Fish Bar" })
  await expect(detail).toContainText("cod up to €9.40 per unit · 100 units")
  await expect(detail).toContainText("Budget €2,000.00")
  await expect(page.getByRole("navigation", { name: "Buyers" })).toContainText("Oslo Fish Bar")
  await detail.getByRole("button", { name: "Pause" }).click()
  await expect(detail.getByText("Paused", { exact: true })).toBeVisible()
  await expect(page.getByText("TEST MONEY")).toBeVisible()
  await axe(page, "new agent detail")
})

test("no-show and dispute from the buyer console (mock)", async ({ page }) => {
  await page.goto(`/buy?speed=50&until=${PAST_DEADLINE}`)
  await ready(page)
  await page
    .getByRole("navigation", { name: "Buyers" })
    .getByRole("button", { name: /Hanse Kitchen/ })
    .click()
  const purchases = page.getByRole("region", { name: "Purchases" })
  const lot60 = purchases.getByRole("listitem").filter({ hasText: "Lot 60" })
  await expect(lot60).toContainText("from Coastal Catch · Sold")
  await axe(page, "agent detail")

  await lot60.getByRole("button", { name: "Seller didn't come" }).click()
  await expect(lot60.getByRole("status")).toContainText("Reported. The seller has until block")

  await lot60.getByRole("button", { name: "Report a problem" }).click()
  await lot60.getByRole("button", { name: "Open camera" }).click()
  await lot60.getByRole("button", { name: "Take photo" }).click()
  await expect(lot60.getByText("1 of 3 photos")).toBeVisible()
  await lot60.getByRole("button", { name: "Send report" }).click()
  await expect(lot60.getByText("Report sent. The held money waits until the goods are checked.")).toBeVisible()
})

test("Watch in town opens the agent's panel", async ({ page }) => {
  await page.goto("/buy?speed=50")
  await ready(page)
  await page
    .getByRole("navigation", { name: "Buyers" })
    .getByRole("button", { name: /Hanse Kitchen/ })
    .click()
  await page.getByRole("link", { name: "Watch in town" }).click()
  await expect(page).toHaveURL(/\/town\?select=agent:0x/)
  await expect(
    page.getByRole("complementary", { name: "Details" }).getByRole("heading", { name: "Hanse Kitchen" }),
  ).toBeVisible()
})
