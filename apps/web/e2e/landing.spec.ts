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

test("the partner logos under the headline take clicks and point at each site", async ({ page }) => {
  await blockMedia(page)
  await page.goto("/")
  await loaderGone(page)
  const row = page.locator(".landing-hero .landing-logos")
  for (const [name, href] of [
    ["Uniswap Foundation", "https://www.uniswapfoundation.org/"],
    ["Chainlink", "https://chain.link/"],
    ["Hedera", "https://hedera.com/"],
  ] as const) {
    const link = row.getByRole("link", { name: new RegExp(`^${name}`) })
    await expect(link).toHaveAttribute("href", href)
    await expect(link.getByRole("img", { name })).toBeVisible()
    // The hero stage ignores the pointer; the logos must not, or nothing under the headline is clickable.
    // Poll: the loader is still fading over the hero for 0.6 s after it reports itself gone.
    const box = (await link.boundingBox())!
    await expect
      .poll(() =>
        page.evaluate(
          ([x, y]) => document.elementFromPoint(x!, y!)?.closest("a")?.getAttribute("href") ?? null,
          [box.x + box.width / 2, box.y + box.height / 2],
        ),
      )
      .toBe(href)
  }
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
  const nav = page.getByRole("banner")
  await expect(nav.getByRole("link", { name: "PUBLIC BOARD" })).toBeHidden()
  await expect(nav.getByRole("link", { name: "OPEN THE TOWN" })).toBeVisible()
  // The three partner logos stay on one row.
  const rows = await page
    .locator(".landing-logos li")
    .evaluateAll((items) => new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size)
  expect(rows).toBe(1)
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // The sections below the hero don't push the page sideways either, and the badges stay on show.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByRole("contentinfo")).toBeInViewport()
  await expect(page.getByText("TEST MONEY", { exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test("past the hero: the partners show, the deal steps leave with the clip, and the nav gets a backing", async ({
  page,
}) => {
  await blockMedia(page)
  await page.goto("/")
  await loaderGone(page)
  await expect(page.locator(".landing")).toHaveAttribute("data-past", "false")

  // At the end of the glide, step 04 is still on screen.
  await scrollTo(page, 1)
  await expect(page.locator(".landing-steps")).toBeInViewport()

  const featuring = page.getByRole("region", { name: "Featuring" })
  // Bring the section to the top of the window: the whole hero is then above it.
  await featuring.evaluate((el) => el.scrollIntoView({ block: "start" }))
  for (const name of ["Uniswap Foundation", "Chainlink", "Hedera"]) {
    await expect(featuring.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(featuring).toHaveAttribute("data-drawn", "true")
  await expect(page.locator(".landing-steps")).not.toBeInViewport()
  await expect(page.locator(".landing")).toHaveAttribute("data-past", "true")

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const footer = page.getByRole("contentinfo")
  await expect(footer.getByRole("link", { name: /^Source code/ })).toBeInViewport()
  await expect(page.locator(".landing-steps")).not.toBeInViewport()
  // The giant wordmark rises in once the footer's links have arrived.
  await expect(footer.locator(".lp-foot-giant svg")).toHaveCSS("opacity", "1")
  // The horizon circle and the giant wordmark are clipped: the page ends where the footer does.
  const ends = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight,
    landing: Math.round(document.querySelector(".landing")!.getBoundingClientRect().bottom + window.scrollY),
  }))
  expect(ends.doc).toBe(ends.landing)

  // Back to top returns to the clip, where the nav floats over it again.
  await footer.getByRole("link", { name: "Back to top" }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5)
  await expect(page.locator(".landing")).toHaveAttribute("data-past", "false")
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
