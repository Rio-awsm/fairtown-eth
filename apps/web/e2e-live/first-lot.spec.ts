import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"

// C 1.3 first lot, laptop-first (D-118): a phone-sized /sell lists cod, a second phone-sized /scan confirms each
// handover through the fallback link (no camera), the desktop /town shows the lot reach Paid in full. Real API, relay
// and chain (anvil fork at Base pace).
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8787"
const PIN = process.env.E2E_SELLER_PIN ?? ""
const VIDEO_DIR = process.env.E2E_VIDEO_DIR
const PHONE = devices["iPhone 13"]

type Winner = { buyer: string; tokenAmount: string }
type Agent = { agentId: string; name: string }

test("first lot: a phone sells, a phone scans, the town shows Paid in full", async ({ browser, request }) => {
  test.setTimeout(10 * 60_000)
  expect(PIN, "E2E_SELLER_PIN (SELLER_PIN in .env) must be set").not.toBe("")
  const errors: string[] = []
  const contexts: BrowserContext[] = []
  const open = async (b: Browser, name: string, use: object): Promise<Page> => {
    const ctx = await b.newContext({
      ...use,
      ...(VIDEO_DIR ? { recordVideo: { dir: `${VIDEO_DIR}/${name}`, size: { width: 1280, height: 720 } } } : {}),
    })
    contexts.push(ctx)
    const p = await ctx.newPage()
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`))
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name} console: ${m.text()}`)
    })
    return p
  }

  // Desktop town, live.
  const town = await open(browser, "town", { viewport: { width: 1920, height: 1080 } })
  await town.goto("/town")
  await town.waitForFunction(() => window.__TOWN__?.status === "live", null, { timeout: 60_000 })

  // Seller phone: pick, PIN, describe, confirm.
  const seller = await open(browser, "seller", PHONE)
  await seller.goto("/sell")
  await seller.getByRole("button", { name: /Ingrid Solheim/ }).tap()
  await seller.getByLabel("PIN").fill(PIN)
  await seller.getByRole("button", { name: "Continue" }).tap()
  await seller.getByPlaceholder("600 kg cod, landed 04:40, Bergen").fill("120 kg cod, Bergen")
  await seller.getByRole("button", { name: "Send" }).tap()
  await expect(seller.getByRole("region", { name: "Your listing" })).toBeVisible({ timeout: 60_000 })
  await seller.getByRole("button", { name: "Confirm and start selling" }).tap()
  await expect(seller.getByRole("region", { name: "Selling now" })).toBeVisible({ timeout: 60_000 })

  // The sale: the advance card says what arrived and what comes at handover.
  const payout = seller.getByRole("region", { name: "Payout" })
  await expect(payout).toContainText("received", { timeout: 4 * 60_000 })
  await expect(payout).toContainText("more at handover")
  const lotId = ((await payout.textContent()) ?? "").match(/Lot (\d+)/)?.[1]
  expect(lotId, "lot id on the payout card").toBeDefined()

  // Who won, by name. Winners are buyers holding lot tokens, so they appear once the keeper has claimed (a few
  // blocks after settle); only then can the seller show a code.
  let winners: Winner[] = []
  await expect
    .poll(
      async () => {
        winners = ((await (await request.get(`${API}/api/lots/${lotId}`)).json()) as { winners?: Winner[] }).winners ?? []
        return winners.length
      },
      { message: "winners holding lot tokens", timeout: 2 * 60_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0)
  const agents = (await (await request.get(`${API}/api/agents`)).json()) as Agent[]
  const nameOf = (a: string) => agents.find((x) => x.agentId.toLowerCase() === a.toLowerCase())?.name ?? a

  // Handovers until the lot is paid in full: the seller shows a code, the scanner phone opens its fallback link and
  // confirms. Agents may finish the rest (the truck delivering for its lot), so re-read the lot before each round.
  let handovers = 0
  for (let i = 0; i < winners.length; i++) {
    if (i > 0) {
      const now = (await (await request.get(`${API}/api/lots/${lotId}`)).json()) as { status: string; winners?: Winner[] }
      if (now.status === "paid_in_full" || !now.winners?.length) break
      winners = [...winners.slice(0, i), ...now.winners]
    }
    const w = winners[i]!
    const buyer = nameOf(w.buyer)
    if (i > 0) {
      // A fresh code screen; the seller session survives the reload (sessionStorage).
      await seller.reload()
      await seller.getByRole("button", { name: /Ingrid Solheim/ }).tap()
    }
    const lotCard = (i === 0 ? payout : seller.getByRole("region", { name: "Your sold lots" }))
      .locator("div", { hasText: `Lot ${lotId}` })
      .first()
    await lotCard.getByRole("button", { name: "Show handover code" }).tap()
    // Several winners: "Who is collecting?" lists them; one winner goes straight to the code. isVisible() does not
    // wait, so wait for whichever appears first.
    const pick = seller.getByRole("button", { name: buyer, exact: true })
    await pick.or(seller.getByRole("link", { name: "Open without the camera" })).first().waitFor({ timeout: 30_000 })
    if (await pick.isVisible()) await pick.tap()
    const link = await seller
      .getByRole("link", { name: "Open without the camera" })
      .getAttribute("href", { timeout: 30_000 })
      .catch(async (e: unknown) => {
        const screen = (await seller.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1200)
        throw new Error(`no handover link for ${buyer} (${w.buyer}). Seller screen: ${screen}`, { cause: e })
      })
    expect(link).toContain("/scan#t=")

    const scanner = await open(browser, `scanner-${i + 1}`, PHONE)
    await scanner.goto(link!)
    await scanner.getByRole("button", { name: new RegExp(`^${buyer}`) }).tap()
    const card = scanner.getByRole("region", { name: "Handover" })
    await expect(card).toContainText(`Lot ${lotId}`)
    await card.getByRole("button", { name: "Confirm" }).tap()
    await expect(scanner.getByRole("status")).toContainText("released to Ingrid Solheim", { timeout: 60_000 })
    await scanner.close()
    handovers++
  }
  expect(handovers, "at least one handover through the phones").toBeGreaterThan(0)

  // Held released: the town shows Paid in full, and the API agrees.
  await town.waitForFunction((id) => window.__TOWN__?.state.lots[id!]?.status === "paid_in_full", lotId, { timeout: 2 * 60_000 })
  const view = (await (await request.get(`${API}/api/lots/${lotId}`)).json()) as { status: string }
  expect(view.status).toBe("paid_in_full")
  const effects = await town.evaluate(() => window.__TOWN__!.effectsSeen)
  expect(effects["setStatus:paid_in_full"] ?? 0).toBeGreaterThan(0)
  expect(errors).toEqual([])
  console.log(`lot ${lotId}: ${handovers} handover(s) through the phones, ${winners.length} winners, paid in full`)
  for (const c of contexts) await c.close()
})
