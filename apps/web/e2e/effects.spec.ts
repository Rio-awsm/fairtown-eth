import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

// Baselines judge the town canvas only. The HUD is DOM over it (its clock reads real time with the relay
// off), and a mask on the zero-size [data-hud] wrapper hides nothing, so hide the HUD before each shot.
const SHOT_OPTS = { maxDiffPixelRatio: 0.01 }
const hideHud = (page: Page) => page.addStyleTag({ content: "[data-hud] { visibility: hidden !important; }" })

type Envelope = { id: string; event: { type: string; kind?: string; lotId?: string; seller?: string } }
const day: Envelope[] = readFileSync(new URL("../src/mocks/day.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Envelope)
const idOf = (match: (e: Envelope["event"]) => boolean) => {
  const found = day.find((e) => match(e.event))
  if (!found) throw new Error("fixture is missing an envelope the baseline needs")
  return found.id
}

/** Every row of the S3 1.3 table, as the effect names the scene records. */
const EXPECTED_EFFECTS = [
  "placeStall",
  "walkTo",
  "showBubble",
  "coinArc",
  "tickPrice:pulse",
  "flashClear",
  "toast:money",
  "fadeStall",
  "driveTruck",
  "setStatus:truck_booked",
  "openVault",
  "moveCrate",
  "setStatus:picked_up",
  "setStatus:delivered",
  "setStatus:paid_in_full",
  "setStatus:no_show_reported",
  "refundCoins",
  "signNoShow",
  "markSeller:new",
  "inspect",
  "refundBadge",
  "setWeather:storm",
  "setLights:festival",
  "setWeather:quiet",
  "plaque",
  "spawnAgent:human",
  "setLights:night",
  "setPhase",
]

const replayDone = (page: Page, timeout = 20_000) =>
  page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout })

test("20x replay plays every effect in the table", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await page.goto("/town?speed=20")
  await replayDone(page)
  const seen = await page.evaluate(() => window.__TOWN__!.effectsSeen)
  const missing = EXPECTED_EFFECTS.filter((e) => !seen[e])
  expect(missing).toEqual([])
  expect(await page.evaluate(() => window.__TOWN__!.rejected)).toBe(0)
  expect(pageErrors).toEqual([])
})

const BASELINES = [
  ["storm", idOf((e) => e.type === "lot.listed" && e.lotId === "12")],
  ["diwali", idOf((e) => e.type === "price.tick" && e.lotId === "30")],
  [
    "no-show",
    idOf(
      (e) =>
        e.type === "seller.record" &&
        e.seller !== undefined &&
        day.some((d) => d.event.type === "noshow.refunded" && d.event.seller === e.seller),
    ),
  ],
] as const

for (const [name, until] of BASELINES) {
  test(`baseline: ${name}`, async ({ page }) => {
    await page.goto(`/town?speed=50&until=${until}`)
    await replayDone(page)
    // Let walks, coins and bubbles finish; weather and lights are static.
    await page.waitForTimeout(1500)
    await hideHud(page)
    await expect(page.locator("#game-container canvas")).toHaveScreenshot(`effects-${name}.png`, SHOT_OPTS)
  })
}
