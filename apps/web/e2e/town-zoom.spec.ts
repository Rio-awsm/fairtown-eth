import { expect, test, type Page } from "@playwright/test"

const mapReady = (page: Page) =>
  page.waitForFunction(() => window.__TOWN__?.map.status === "ready", null, { timeout: 20_000 })
const camera = (page: Page) => page.evaluate(() => window.__TOWN__!.camera)
const zoomIs = (page: Page, zoom: number) =>
  page.waitForFunction((z) => Math.abs(window.__TOWN__!.camera.zoom - z) < 0.01, zoom, { timeout: 5_000 })

/** A trackpad: small wheel deltas, with ctrl held for a pinch. Playwright's mouse.wheel cannot set ctrl. */
const trackpad = (page: Page, deltaY: number, ctrlKey: boolean, times: number) =>
  page.evaluate(
    ({ deltaY, ctrlKey, times }) => {
      const canvas = document.querySelector("#game-container canvas")!
      const r = canvas.getBoundingClientRect()
      for (let i = 0; i < times; i++)
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY,
            ctrlKey,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        )
    },
    { deltaY, ctrlKey, times },
  )

test("a mouse wheel zooms one step per notch towards the cursor, up to the street view", async ({ page }) => {
  await page.goto("/town?relay=off")
  await mapReady(page)
  const home = await camera(page)
  expect(home.zoom).toBe(1)
  const box = (await page.locator("#game-container canvas").boundingBox())!
  // Over the left side of the town: the view should move towards it, not stay centred.
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5)
  await page.mouse.wheel(0, -100)
  await zoomIs(page, 1.5)
  expect((await camera(page)).x).toBeLessThan(home.x)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(80)
  }
  await zoomIs(page, 6)
  await page.mouse.wheel(0, 100)
  await zoomIs(page, 4)
})

test("a trackpad scroll or pinch zooms smoothly, then settles on a step", async ({ page }) => {
  await page.goto("/town?relay=off")
  await mapReady(page)
  await trackpad(page, -8, true, 12)
  expect((await camera(page)).zoom).toBeGreaterThan(1.5)
  await page.waitForTimeout(700)
  expect([1, 1.5, 2, 3, 4, 6]).toContain((await camera(page)).zoom)
  await trackpad(page, 10, false, 60)
  await page.waitForTimeout(700)
  expect((await camera(page)).zoom).toBe(1)
})

test("drag pans when zoomed in, + and − step, and 0 returns to the whole town", async ({ page }) => {
  await page.goto("/town?relay=off")
  await mapReady(page)
  await page.keyboard.press("+")
  await zoomIs(page, 1.5)
  await page.keyboard.press("=")
  await zoomIs(page, 2)
  const before = await camera(page)
  const box = (await page.locator("#game-container canvas").boundingBox())!
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6, { steps: 5 })
  await page.mouse.up()
  expect((await camera(page)).x).toBeGreaterThan(before.x)
  await page.keyboard.press("-")
  await zoomIs(page, 1.5)
  await page.keyboard.press("0")
  await zoomIs(page, 1)
})

test("no two town labels overlap, at the whole-town view and close up", async ({ page }) => {
  await page.goto("/town?speed=50")
  await page.waitForFunction(() => window.__TOWN__?.status === "replay_done", null, { timeout: 30_000 })
  const overlaps = () =>
    page.evaluate(() => {
      const els = [
        ...document.querySelectorAll<HTMLElement>(".ft-bubble, .ft-stall, .ft-weather, .ft-plaque, .ft-sign, .ft-tag"),
      ]
        .filter((el) => el.style.display !== "none" && !el.classList.contains("ft-hidden"))
        .map((el) => ({ name: el.textContent ?? "", r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
      const out: string[] = []
      for (let i = 0; i < els.length; i++)
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i]!.r
          const b = els[j]!.r
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
            out.push(`${els[i]!.name} / ${els[j]!.name}`)
        }
      return out
    })
  await page.waitForTimeout(400)
  expect(await overlaps()).toEqual([])
  await page.keyboard.press("+")
  await page.keyboard.press("+")
  await page.waitForTimeout(600)
  expect(await overlaps()).toEqual([])
})
