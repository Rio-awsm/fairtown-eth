/**
 * C 2.3 e2e:day: every service on the anvil fork (keeper, agents, relay, web, CRE bridge for the director's signals),
 * the director's full_day, watched from the live town (apps/web/e2e-live/day.spec.ts), then chain checks and the guide's
 * feature table. Rows proven by another e2e say which one; rows nothing automated proves say so. `pnpm e2e:day`.
 */
import { readFileSync } from "node:fs"
import { marketSettlementAbi, lotFactoryAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { parseEventLogs, type AbiEvent, type Address, type Log } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { ANVIL_URL, env, RELAY_PORT, root, Run, runPlaywright, startStack } from "./stack"

const run = new Run("e2e-day", "anvil")
console.log("Fairtown e2e:day on anvil (TEST MONEY; signals through CRE simulation; W3 rulings mocked elsewhere)")
const dep = await loadDeployment("anvil")
const settlement = dep.contracts.MarketSettlement as Address
const out = `${run.runDir}/day.json`
const { pub } = await startStack(run, { relay: true, web: true, cre: true, baseSpeed: true })
const start = await pub.getBlockNumber()
const code = await runPlaywright("e2e-live/day.spec.ts", { E2E_DAY_OUT: out, E2E_RELAY_URL: `http://127.0.0.1:${RELAY_PORT}`, E2E_ANVIL_URL: ANVIL_URL })
if (code !== 0) run.fail(`Playwright exited with code ${code}`)
const day = JSON.parse(readFileSync(out, "utf8")) as { effects: Record<string, number>; lots: { lotId: string; commodity: string; sector: string; status: string; parentLotId?: string }[]; seconds: number }

// Chain evidence.
const ev = (abi: readonly unknown[], name: string) => (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!
const logs = async (address: Address, abi: readonly unknown[], name: string) =>
  parseEventLogs({ abi: abi as never, logs: (await pub.getLogs({ address, event: ev(abi, name), fromBlock: start, toBlock: "latest" } as never)) as Log[] }) as unknown as { args: Record<string, unknown> }[]
const listed = await logs(dep.contracts.LotFactory as Address, lotFactoryAbi, "LotListed")
const settled = await logs(settlement, marketSettlementAbi, "LotSettled")
const relisted = await logs(settlement, marketSettlementAbi, "LotRelisted")
const delivered = await logs(settlement, marketSettlementAbi, "LotDelivered")
const paidInFull = await logs(settlement, marketSettlementAbi, "LotPaidInFull")
const refunds = await logs(settlement, marketSettlementAbi, "NoShowRefunded")
const carriers = await logs(settlement, marketSettlementAbi, "CarrierAssigned")
const handovers = await logs(settlement, marketSettlementAbi, "HandoverConfirmed")
run.stop()

const tiers = new Set(settled.map((s) => Number(s.args.advanceBps)))
const currencyOf = new Map(listed.map((l) => [String(l.args.lotId), String(l.args.currency).toLowerCase()]))
const soldCurrencies = new Set(settled.filter((s) => (s.args.soldUnits as bigint) > 0n).map((s) => currencyOf.get(String(s.args.lotId))))
const eur = dep.contracts.TestEUR.toLowerCase()
const usd = dep.contracts.TestUSD.toLowerCase()
const personas = JSON.parse(readFileSync(`${root}packages/shared/fixtures/agents.json`, "utf8")) as { id: string; role: string }[]
const societies = new Set(personas.flatMap((p, i) => (p.role === "SOCIETY" && env.AGENT_MNEMONIC ? [mnemonicToAccount(env.AGENT_MNEMONIC, { addressIndex: i }).address.toLowerCase()] : [])))
const societyCollected = handovers.some((h) => societies.has(String(h.args.buyer).toLowerCase()))
const carrierCount = new Map<string, number>()
for (const c of carriers) carrierCount.set(String(c.args.carrier).toLowerCase(), (carrierCount.get(String(c.args.carrier).toLowerCase()) ?? 0) + 1)
const lotBy = (commodity: string) => day.lots.filter((l) => l.commodity === commodity)
const fx = (e: string) => (day.effects[e] ?? 0) > 0
const DONE = new Set(["paid_in_full", "delivered", "refunded"])

type Row = [string, "pass" | "fail" | string, string]
const here = (ok: boolean, evidence: string): ["pass" | "fail", string] => [ok ? "pass" : "fail", evidence]
const rows: Row[] = [
  ["Seller lists by text", "e2e:first-lot", "/sell on a phone viewport, real API"],
  ["English voice", "not automated", "browser speech (D-08); manual check"],
  ["AI grading with EU freshness rubric", "e2e:first-lot", "draft card grade (rules on the fork, MOCK_AI); LLM grading on Base Sepolia runs"],
  ["CCA auction in tEUR and tUSD", ...here(soldCurrencies.has(eur) && soldCurrencies.has(usd), `${settled.length} lots settled; currencies sold: ${[...soldCurrencies].map((c) => (c === eur ? "tEUR" : c === usd ? "tUSD" : c)).join(", ")}`)],
  ["New seller 50%, proven 90%, truck 10%", ...here(tiers.has(5000) && tiers.has(1000), `advance tiers seen: ${[...tiers].sort().join(", ")} bps${tiers.has(9000) ? "" : " (no proven-seller sale in this run)"}`)],
  ["QR handover", "e2e:first-lot", "seller phone code, scanner phone confirms"],
  ["Drop-off scan", ...here(delivered.length > 0 && fx("setStatus:delivered"), `${delivered.length} LotDelivered; town setStatus:delivered ${day.effects["setStatus:delivered"] ?? 0}`)],
  ["No-show refund, record marked", ...here(refunds.length > 0 && fx("refundCoins"), `${refunds.length} NoShowRefunded (Coastal Catch); town refundCoins ${day.effects.refundCoins ?? 0}, markSeller:new ${day.effects["markSeller:new"] ?? 0}`)],
  ["Contested no-show ruling", "e2e:trust", "seller contests with PIN session; ruling MOCKED (W3 cut, D-119)"],
  ["Quality dispute", "e2e:chainlink", "POST /api/disputes on chain; ruling MOCKED (D-119)"],
  ["Buyer silence pays seller", "e2e:trust", "releaseExpired pays everything held"],
  ["Chained truck, backhaul", ...here(carriers.length > 0 && fx("driveTruck"), `${carriers.length} CarrierAssigned; most trips by one truck: ${Math.max(0, ...carrierCount.values())}; town driveTruck ${day.effects.driveTruck ?? 0}`)],
  ["Dallas standalone truck", ...here(lotBy("truck_capacity").some((l) => (l.parentLotId ?? "0") === "0" && DONE.has(l.status)), `standalone truck_capacity lots: ${lotBy("truck_capacity").filter((l) => (l.parentLotId ?? "0") === "0").map((l) => `${l.lotId} ${l.status}`).join(", ")}`)],
  ["GPU hours, simulated provider", ...here(lotBy("gpu_hour").some((l) => DONE.has(l.status)), `gpu_hour lots: ${lotBy("gpu_hour").map((l) => `${l.lotId} ${l.status}`).join(", ")}`)],
  // Storage is booked only when Mile 12 Co-op wins tomatoes beyond its mandate: an auction outcome, like relists.
  [
    "Cold storage",
    day.lots.some((l) => l.sector === "storage") && fx("openVault") ? "pass" : "agents sector test",
    day.lots.some((l) => l.sector === "storage")
      ? `storage lots: ${day.lots.filter((l) => l.sector === "storage").map((l) => `${l.lotId} ${l.status}`).join(", ")}; town openVault ${day.effects.openVault ?? 0}`
      : "no co-op overflow this run; FakeChain test 'Lagos tomatoes: the winner books cold storage' proves the path",
  ],
  ["Fish relists with decaying floors", relisted.length > 0 ? "pass" : "not in this run", `${relisted.length} LotRelisted${relisted.length ? ` (new floors ${relisted.map((r) => String(r.args.newFloorPerUnit)).join(", ")})` : " (every lot sold out)"}`],
  ["Society pooled buying", societyCollected ? "pass" : "not in this run", societyCollected ? "a housing society collected its share" : "no society won a lot this run"],
  ["Storm and Diwali signals", ...here(fx("setWeather:storm") && fx("setLights:festival"), `town setWeather:storm ${day.effects["setWeather:storm"] ?? 0}, setLights:festival ${day.effects["setLights:festival"] ?? 0}`)],
  ["FX and reference", "e2e:chainlink", "W1 FxUpdated, ReferencePriceUpdated; /api/fx, /api/reference follow"],
  ["QR walk-in bid", "not automated live", "S3 mock e2e (walkin.spec); live run manual"],
  ["Price weather, board query", "e2e:arkiv (partial)", "price entities on Rabdi; browser board check manual"],
  ["Seller advice", "e2e:arkiv", "advice cites the ledger"],
  ["Panels with explorer links", "web unit tests", "links on Base Sepolia; local fork shows (local), not dead links"],
]
const w = Math.max(...rows.map((r) => r[0].length))
console.log(`\nFull day: ${day.seconds.toFixed(0)}s of play, ${listed.length} lots, ${settled.length} settled, ${paidInFull.length} paid in full\n`)
for (const [name, state, evidence] of rows) console.log(`  ${name.padEnd(w)}  ${state.padEnd(20)}  ${evidence}`)
const failed = rows.filter((r) => r[1] === "fail")
if (failed.length) run.fail(`rows without evidence in this run: ${failed.map((r) => r[0]).join("; ")}`)
console.log(`\nE2E DAY PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s`)
console.log(`  service logs: ${run.runDir}`)
process.exit(0)
