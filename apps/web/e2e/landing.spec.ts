import { expect, test, type Page } from "@playwright/test"

// The clip and poster come from a CDN. Tests must not depend on it, so most of them block it and
// check that the hero works without its media; the last one lets it through when it is reachable.
const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/**"
const blockMedia = (page: Page) => page.context().route(CDN, (route) => route.abort())

const scrollTo = (page: Page, p: number) =>
  page.evaluate((p) => {
    const t = document.querySelector<HTMLElement>(".landing-track")!
    window.scrollTo(0, p * (t.offsetHeight - window.innerHeight))
  }, p)

const steps = (page: Page) => page.locator(".landing-step")
// The page must have rendered and marked itself loaded: a bare toBeHidden would pass before render.
const loaderGone = async (page: Page) => {
  await expect(page.locator(".landing")).toHaveAttribute("data-loaded", "true", { timeout: 6_000 })
  await expect(page.getByRole("status", { name: "Loading" })).toBeHidden()
}

test("without its clip the loader still gives way within 3.5 s and scrolling drives the hero", async ({ page }) => {
  await blockMedia(page)
  await page.goto("/")
  await loaderGone(page)
  const headline = page.getByRole("heading", { level: 1, name: /One Fair Price/ })
  await expect(headline).toBeVisible()
  await expect(steps(page).first()).toHaveAttribute("aria-current", "step")

  await scrollTo(page, 0.3)
  await expect(headline).toBeHidden()
  await expect(page.locator(".landing-steps")).toBeVisible()
  await expect(steps(page).first()).toHaveAttribute("aria-current", "step")

  await scrollTo(page, 0.5)
  await expect(steps(page).nth(1)).toHaveAttribute("aria-current", "step")
  await scrollTo(page, 0.7)
  await expect(steps(page).nth(2)).toHaveAttribute("aria-current", "step")
  await scrollTo(page, 0.9)
  await expect(steps(page).nth(3)).toHaveAttribute("aria-current", "step")
  await expect(steps(page).first()).not.toHaveAttribute("aria-current")

  // Scrolling back reverses everything.
  await scrollTo(page, 0)
  await expect(headline).toBeVisible()
  await expect(steps(page).first()).toHaveAttribute("aria-current", "step")
  await expect(page.locator(".landing-steps")).toBeHidden()
})

test("the headline lies back into the ground as it goes", async ({ page }) => {
  await blockMedia(page)
  await page.goto("/")
  await loaderGone(page)
  await scrollTo(page, 0.15)
  const style = await page.locator(".landing-hero").evaluate((el) => ({
    transform: el.style.transform,
    opacity: Number(el.style.opacity),
  }))
  expect(style.transform).toMatch(/translateY\(-[\d.]+vh\) rotateX\([\d.]+deg\) scale\(0\.[\d]+\)/)
  expect(style.opacity).toBeGreaterThan(0)
  expect(style.opacity).toBeLessThan(1)
})

test("a phone gets the one-column layout with no sideways scroll", async ({ page }) => {
  await blockMedia(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await loaderGone(page)
  await expect(page.getByRole("link", { name: "PUBLIC BOARD" })).toBeHidden()
  await expect(page.getByRole("link", { name: "OPEN THE TOWN" })).toBeVisible()
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test("recorder mode: no loader, and __recTime places the glide and returns the clip time", async ({ page }) => {
  await blockMedia(page)
  await page.goto("/?rec=1")
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0)
  await page.waitForFunction(() => typeof window.__recTime === "function")
  const atEnd = await page.evaluate(() => {
    const v = document.querySelector("video")!
    Object.defineProperty(v, "duration", { value: 5.04 })
    return window.__recTime!(v, 6.5)
  })
  expect(atEnd).toBeCloseTo(5.04 - 1 / 48)
  await expect(steps(page).nth(3)).toHaveAttribute("aria-current", "step")
  await expect(page.getByRole("heading", { level: 1, name: /One Fair Price/ })).toBeHidden()
})

test("with its clip reachable, scrolling scrubs the video forward and back", async ({ page }) => {
  await page.goto("/")
  const ready = await page
    .waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2, null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!ready, "the clip's CDN is not reachable from here")
  await loaderGone(page)
  // Seeking a streamed clip is slow while other tests keep the GPU busy: allow it time.
  await scrollTo(page, 1)
  await page.waitForFunction(() => document.querySelector("video")!.currentTime > 4, null, { timeout: 20_000 })
  await scrollTo(page, 0)
  await page.waitForFunction(() => document.querySelector("video")!.currentTime < 0.2, null, { timeout: 20_000 })
})
