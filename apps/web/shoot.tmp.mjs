import { chromium } from "@playwright/test"
const [out, ...names] = process.argv.slice(2)
const all = {town:["/town?speed=20&until=d-0040",1920,1080,7000],live:["/town?speed=8",1920,1080,9000],sell:["/sell",390,844,2500],buy:["/buy",1440,900,2500],walkin:["/walkin",390,844,2500],board:["/board",1440,900,3000],control:["/control",1440,900,2000],scan:["/scan",390,844,2000],night:["/town?speed=20&until=d-0074",1920,1080,9000]}
const b = await chromium.launch()
for (const n of names) {
  const [u,w,h,wait] = all[n]
  const p = await b.newPage({ viewport: { width: w, height: h } })
  p.on("console", m => { if (m.type()==="error") console.log(n, "console error:", m.text()) })
  p.on("pageerror", e => console.log(n, "pageerror:", e.message))
  await p.goto("http://localhost:8090"+u); await p.waitForTimeout(wait)
  await p.screenshot({ path: `${out}/${n}.png` }); await p.close()
}
await b.close()
