import { chromium, devices } from "@playwright/test"
const port = process.argv[2] ?? "8090"
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } })
const p = await ctx.newPage()
await p.goto(`http://localhost:${port}/town?stress=1&speed=50` + (process.argv[3] ?? ""))
await p.waitForFunction(() => (window.__TOWN__?.agents.active ?? 0) >= 60 && (window.__TOWN__?.stallsOnScreen.length ?? 0) >= 18, null, { timeout: 20000 })
await p.waitForTimeout(4000)
const s = []
for (let i = 0; i < 10; i++) { await p.waitForTimeout(500); s.push(await p.evaluate(() => window.__TOWN__.fps)) }
console.log(process.argv[3] ?? "", "avg", (s.reduce((a, c) => a + c, 0) / s.length).toFixed(1))
await b.close()
