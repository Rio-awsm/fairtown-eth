import { expect, test } from "@playwright/test"

type Sample = {
  status: string | undefined
  rejected: number
  active: number
  agents: { id: string; blocked: boolean; queue: string | null }[]
  trucks: { id: string; blocked: boolean }[]
}

test("10x replay: no agent on water or buildings, no shared queue spot, never more than 80", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await page.goto("/town?speed=10")
  await page.waitForFunction(() => window.__TOWN__?.map.status === "ready", null, { timeout: 10_000 })

  const violations: string[] = []
  let maxActive = 0
  let trucksSeen = 0
  let last: Sample | undefined
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const t = window.__TOWN__!
      return { status: t.status, rejected: t.rejected, ...t.agents }
    })
    maxActive = Math.max(maxActive, last.active)
    trucksSeen = Math.max(trucksSeen, last.trucks.length)
    for (const a of last.agents) if (a.blocked) violations.push(`${a.id} on a blocked tile`)
    for (const t of last.trucks) if (t.blocked) violations.push(`truck for lot ${t.id} off the road`)
    const spots = last.agents.flatMap((a) => (a.queue ? [a.queue] : []))
    if (new Set(spots).size !== spots.length) violations.push(`shared queue spot: ${spots.join(", ")}`)
    if (last.status === "replay_done") break
    await page.waitForTimeout(200)
  }

  expect(last?.status).toBe("replay_done")
  expect(violations).toEqual([])
  expect(maxActive).toBeLessThanOrEqual(80)
  expect(last?.active).toBe(15) // 14 personas plus the walk-in judge in the fixture
  expect(last?.rejected).toBe(0)
  expect(trucksSeen).toBeGreaterThan(0)
  expect(pageErrors).toEqual([])
})
