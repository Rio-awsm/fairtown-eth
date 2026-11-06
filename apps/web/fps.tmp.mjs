import { chromium } from "@playwright/test"
const q = process.argv[2] ?? ""
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto("http://localhost:8090/town?stress=1&speed=50" + q)
await p.waitForFunction(() => (window.__TOWN__?.agents.active ?? 0) >= 60, null, { timeout: 20000 }); if (process.argv[3] === "nohud") await p.addStyleTag({ content: "[data-hud]{display:none !important}" })
await p.waitForTimeout(4000)
const s = []
for (let i = 0; i < 8; i++) { await p.waitForTimeout(500); s.push(await p.evaluate(() => window.__TOWN__.fps)) }
console.log(q || "(baseline)", "avg", (s.reduce((a, c) => a + c, 0) / s.length).toFixed(1))
await b.close()
