import { expect, test, type Page } from "@playwright/test"

const mapReady = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.map.status === "ready", null, { timeout: 15_000 })

// Runs in the "perf" project, after every other project, so other browsers do not steal the CPU.
test("60 agents and 18 stalls hold 50+ fps", async ({ page }) => {
  await page.goto("/town?stress=1&speed=50")
  await mapReady(page)
  await page.waitForFunction(
    () => (window.__TOWN__?.agents.active ?? 0) >= 60 && (window.__TOWN__?.stallsOnScreen.length ?? 0) >= 18,
    null,
    {
      timeout: 15_000,
    },
  )
  // Phaser's actualFps is a smoothed average: let it settle before sampling.
  await page.waitForTimeout(4000)
  const samples: number[] = []
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500)
    samples.push(await page.evaluate(() => window.__TOWN__!.fps))
  }
  const average = samples.reduce((a, b) => a + b, 0) / samples.length
  console.log(`fps samples ${samples.join(", ")} average ${average.toFixed(1)}`)
  expect(average).toBeGreaterThanOrEqual(50)
})
