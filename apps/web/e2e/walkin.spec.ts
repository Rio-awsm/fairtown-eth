import { readFileSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

type Envelope = { id: string; event: { type: string; lotId?: string } }
const day: Envelope[] = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Envelope)
// Stop the mock day while the Diwali marigolds (Lot 30) are still on sale.
const UNTIL = day.find((e) => e.event.type === "price.tick" && e.event.lotId === "30")!.id
const CRYPTO = /\b(wallet|gas|token|crypto|blockchain)\b/i

async function check(page: Page, state: string) {
  expect((await page.locator("body").innerText()).replace(/[\u00a0\u202f]/g, " "), `crypto word (${state})`).not.toMatch(CRYPTO)
  const r = await new AxeBuilder({ page }).analyze()
  expect(
    r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `axe (${state})`,
  ).toEqual([])
}

test("a judge joins from a phone, picks the marigolds, slides the price and bids", async ({ page }) => {
  await page.goto(`/walkin?speed=50&until=${UNTIL}`)
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })
  await check(page, "join")

  await page.getByRole("textbox", { name: "Your name" }).fill("Priya")
  await page.getByText("Trader").tap()
  await page.getByRole("button", { name: "Join the market" }).tap()
  await expect(page.getByText("Hi Priya")).toBeVisible()

  await page.getByRole("button", { name: /Lot 30 · 2000 kg marigold/ }).tap()
  const price = page.getByRole("status", { name: "Price" })
  const before = await price.innerText()
  const slider = page.getByRole("slider", { name: "Your highest price" })
  await slider.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
  await expect(price).not.toHaveText(before)
  await page.getByRole("textbox", { name: "How much to spend (USD)" }).fill("20")
  await expect(page.getByText(/^About \d+ kg at most$/)).toBeVisible()
  await check(page, "bid form")

  await page.getByRole("button", { name: "Place bid" }).tap()
  const card = page.getByRole("region", { name: "Your bid" })
  await expect(card).toContainText("Your bid is in: up to")
  await expect(card).toContainText("$20.00 to spend")
  await expect(card).toContainText("You're winning right now.")
  await check(page, "result")

  await page.reload()
  await expect(page.getByText("Hi Priya")).toBeVisible()
})

test("the walk-in page fits a phone without sideways scrolling", async ({ page }) => {
  await page.goto("/walkin")
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})
