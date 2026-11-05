import { readFileSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { MOCK_HANSE, MOCK_LOT12_UNITS, mockQrText, mockTicket } from "../src/mocks/ticket"

type Envelope = { id: string; event: { type: string; lotId?: string } }
const day: Envelope[] = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Envelope)
// Stop the mock day when Lars is booked for Lot 12: sold, truck on its way, nothing handed over yet.
const UNTIL = day.find((e) => e.event.type === "carrier.assigned" && e.event.lotId === "12")!.id
const READY = `speed=50&until=${UNTIL}`
const CRYPTO = /\b(wallet|gas|token|crypto|blockchain)\b/i

const ready = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 20_000 })

async function check(page: Page, state: string) {
  expect((await page.locator("body").innerText()).replace(/[\u00a0\u202f]/g, " "), `crypto word (${state})`).not.toMatch(CRYPTO)
  const axe = await new AxeBuilder({ page }).analyze()
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `axe (${state})`,
  ).toEqual([])
}

test("two phones: the seller shows the code, the truck scans it with the camera and confirms", async ({
  page,
  context,
}) => {
  const seller = page
  await seller.goto(`/sell?${READY}`)
  await ready(seller)
  await seller.getByRole("button", { name: /Ingrid Solheim/ }).tap()
  await seller.getByRole("region", { name: "Your sold lots" }).getByRole("button", { name: "Show handover code" }).tap()
  const code = seller.getByRole("img", { name: "Handover code for Lot 12" })
  await expect(code).toHaveAttribute("data-qr", mockQrText(mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS)))
  await expect(seller.getByText(/^Expires in \d+:\d\d$/)).toBeVisible()
  await check(seller, "seller code")

  const truck = await context.newPage()
  await truck.goto(`/scan?${READY}`)
  await ready(truck)
  await check(truck, "receiver picker")
  await truck.getByRole("button", { name: /^Lars/ }).tap()
  const card = truck.getByRole("region", { name: "Handover" })
  await expect(card).toContainText("600 kg cod from Ingrid Solheim, Lot 12.", { timeout: 15_000 })
  await expect(card).toContainText("Inspect first. Scanning means you accept the goods.")
  await check(truck, "confirm card")
  await card.getByRole("button", { name: "Confirm" }).tap()
  await expect(truck.getByRole("status")).toContainText("Done. €2,702.70 released to Ingrid Solheim.")
  await check(truck, "done")
})

test("drop-off: the truck shows its code and the buyer opens the link without a camera", async ({ page, context }) => {
  await page.goto(`/sell?${READY}`)
  await ready(page)
  await page.getByRole("button", { name: /^Lars/ }).tap()
  const lot20 = page.getByRole("region", { name: "Your sold lots" }).locator("div", { hasText: "Lot 20" }).first()
  await lot20.getByRole("button", { name: "Show handover code" }).tap()
  const link = await page.getByRole("link", { name: "Open without the camera" }).getAttribute("href")
  expect(link).toContain("/scan?code=")

  const buyer = await context.newPage()
  await buyer.goto(`${link}&${READY}`)
  await ready(buyer)
  await buyer.getByRole("button", { name: /^Hanse Kitchen/ }).tap()
  const card = buyer.getByRole("region", { name: "Handover" })
  await expect(card).toContainText("Lot 20.")
  await expect(card).toContainText("from Lars")
  await card.getByRole("button", { name: "Confirm" }).tap()
  await expect(buyer.getByRole("status")).toContainText("released to Lars")
})

test("a code opened by the wrong person explains itself and offers no Confirm", async ({ page }) => {
  const code = mockQrText(mockTicket("12", MOCK_HANSE, MOCK_LOT12_UNITS))
  await page.goto(`/scan?code=${encodeURIComponent(code)}&${READY}`)
  await ready(page)
  await page.getByRole("button", { name: /^Gulf Produce/ }).tap()
  await expect(page.getByRole("alert")).toContainText("This code is for someone else.")
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0)
  await check(page, "wrong person")
})
