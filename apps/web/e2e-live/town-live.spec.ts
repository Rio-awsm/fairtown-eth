import { expect, test } from "@playwright/test"
import type { TownCommand } from "../src/game/commands"
import { mergeLog, walkBeforeBid } from "../src/test/liveOrder"

// C 1.2: a lot listed through the real API on the anvil fork shows up in the live town: stall, walkers, ticks, the
// clearing flash, the money toast and the sold status. Agents walk before their bids land.
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8787"
const LISTING = { sellerId: "ingrid", text: "120 kg cod, Bergen", floorPerUnit: "7500000", durationBlocks: 40 }
const EFFECTS = ["placeStall", "walkTo", "coinArc", "tickPrice:pulse", "flashClear", "toast:money", "setStatus:sold"]

type Probe = {
  log: TownCommand[]
  effects: Record<string, number>
  status: string
  rejected: number
  lotStatus: string | undefined
  stalls: string[]
  agents: number
}

test("a live lot drives the town: stall, walkers, ticks, flash, toast, status", async ({ page, request }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`))
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.request().method()} ${r.url()} -> ${r.status()}`)
  })

  await page.goto("/town")
  await page.waitForFunction(() => window.__TOWN__?.status === "live", null, { timeout: 60_000 })
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible()
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()

  const post = async <T>(path: string, data: object): Promise<T> => {
    const res = await request.post(`${API}${path}`, { data })
    expect(res.ok(), `${path} -> ${res.status()} ${await res.text()}`).toBe(true)
    return (await res.json()) as T
  }
  const { draftId } = await post<{ draftId: string }>("/api/listings/draft", { sellerId: LISTING.sellerId, text: LISTING.text })
  const { lotId } = await post<{ lotId: string }>("/api/listings/confirm", {
    draftId,
    floorPerUnit: LISTING.floorPerUnit,
    durationBlocks: LISTING.durationBlocks,
  })

  // Poll the read-only hook and stitch commandLog windows (it keeps only the last 200 commands).
  let log: TownCommand[] = []
  let probe: Probe | undefined
  const deadline = Date.now() + 4 * 60_000
  while (Date.now() < deadline) {
    probe = await page.evaluate((id): Probe => {
      const t = window.__TOWN__!
      return {
        log: [...t.commandLog],
        effects: { ...t.effectsSeen },
        status: t.status,
        rejected: t.rejected,
        lotStatus: t.state.lots[id]?.status,
        stalls: t.stallsOnScreen.map((s) => s.lotId),
        agents: Object.keys(t.state.agents).length,
      }
    }, lotId)
    log = mergeLog(log, probe.log)
    const done = EFFECTS.every((e) => (probe!.effects[e] ?? 0) > 0) && probe.lotStatus === "sold"
    if (done) break
    await page.waitForTimeout(200)
  }
  if (!probe) throw new Error("no probe")

  const missing = EFFECTS.filter((e) => !(probe!.effects[e] ?? 0))
  expect(missing, `effects not seen: ${missing.join(", ")}`).toEqual([])
  expect(probe.lotStatus).toBe("sold")
  expect(log.some((c) => c.kind === "placeStall" && c.lotId === lotId)).toBe(true)
  expect(log.some((c) => c.kind === "flashClear" && c.lotId === lotId)).toBe(true)
  expect(log.some((c) => c.kind === "tickPrice" && c.lotId === lotId)).toBe(true)

  const order = walkBeforeBid(log, lotId)
  expect(order.bidders.length, "at least 2 agents bid").toBeGreaterThanOrEqual(2)
  expect(order.walkers.length, "at least 2 walkers").toBeGreaterThanOrEqual(2)
  expect(order.violations, "bids that landed before their agent walked").toEqual([])

  expect(probe.status).toBe("live")
  expect(probe.rejected).toBe(0)
  console.log(`console errors (${consoleErrors.length}):\n  ${[...new Set(consoleErrors)].join("\n  ")}`)
  console.log(`failed requests (${failedRequests.length}):\n  ${[...new Set(failedRequests)].join("\n  ")}`)
  expect(pageErrors).toEqual([])
  console.log(
    `lot ${lotId}: ${order.bids} bids from ${order.bidders.length} agents, ${order.walkers.length} walkers, ` +
      `${log.length} commands, ${probe.agents} agents in town, stall on screen: ${probe.stalls.includes(lotId)}`,
  )
})
