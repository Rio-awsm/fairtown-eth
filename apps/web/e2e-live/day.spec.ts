import { writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

// C 2.3: the director's full_day on the anvil fork, watched from the live town. Phase 1 runs at Base pace until every
// scene has started and every auction has closed; phase 2 fast-forwards (anvil_mine) through pickup, report and contest
// windows. Effects come from __TOWN__.effectsSeen; lots from the relay snapshot. Results go to E2E_DAY_OUT for the
// runner's chain checks and row table.
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8787"
const RELAY = process.env.E2E_RELAY_URL ?? "http://127.0.0.1:8788"
const ANVIL = process.env.E2E_ANVIL_URL ?? "http://127.0.0.1:8545"
const OUT = process.env.E2E_DAY_OUT

const DONE = new Set(["paid_in_full", "refunded", "unsold", "relisted"])
type SnapLot = { lotId: string; commodity: string; sector: string; status: string; currency?: string; parentLotId?: string }
type Snapshot = { block: number; lots: SnapLot[] }
type Status = { running: { name: string; done: string[]; next: string | null }[] }

test("full_day: every scene plays in the live town", async ({ page, request }) => {
  test.setTimeout(16 * 60_000)
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/town")
  await page.waitForFunction(() => window.__TOWN__?.status === "live", null, { timeout: 60_000 })

  const started = await request.post(`${API}/api/director/scenario`, { data: { name: "full_day" } })
  expect(started.ok(), await started.text()).toBe(true)
  const t0 = Date.now()
  const snap = async () => (await (await request.get(`${RELAY}/snapshot`)).json()) as Snapshot
  const status = async () => (await (await request.get(`${API}/api/director/status`)).json()) as Status
  const mine = (n: number) => request.post(ANVIL, { data: { jsonrpc: "2.0", id: 1, method: "anvil_mine", params: [`0x${n.toString(16)}`] } })

  // Phase 1: all scenes started, every auction closed.
  for (;;) {
    const s = await status()
    const run = s.running.find((r) => r.name === "full_day")
    const lots = (await snap()).lots
    // A finished scenario leaves `running`; until then `next` names the scene still to come.
    const scenesDone = !run || run.next === null
    if (scenesDone && lots.length > 0 && lots.every((l) => l.status !== "open")) break
    if (Date.now() - t0 > 9 * 60_000) throw new Error(`phase 1 timed out: next scene "${run?.next}", open lots ${lots.filter((l) => l.status === "open").length}`)
    await page.waitForTimeout(3_000)
  }
  console.log(`phase 1 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`)

  // Phase 2: fast-forward until every lot reached an end state (scripted handovers, no-show refund, truck drop-offs).
  const t1 = Date.now()
  let lots: SnapLot[] = []
  for (;;) {
    lots = (await snap()).lots
    if (lots.every((l) => DONE.has(l.status))) break
    if (Date.now() - t1 > 5 * 60_000) break
    await mine(100)
    await page.waitForTimeout(1_500)
  }
  console.log(`phase 2 done in ${((Date.now() - t1) / 1000).toFixed(0)}s`)
  await page.waitForTimeout(3_000) // last effects reach the page

  const effects = await page.evaluate(() => ({ ...window.__TOWN__!.effectsSeen }))
  const rejected = await page.evaluate(() => window.__TOWN__!.rejected)
  if (OUT) writeFileSync(OUT, JSON.stringify({ effects, lots, rejected, errors, seconds: (Date.now() - t0) / 1000 }, null, 2))
  console.log(`lots: ${lots.map((l) => `${l.lotId} ${l.commodity} ${l.status}`).join("; ")}`)
  expect(rejected).toBe(0)
  expect(errors).toEqual([])
})
