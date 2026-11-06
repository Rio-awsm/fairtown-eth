/**
 * C 2.2 e2e:arkiv against live Rabdi, on Base Sepolia (the fork keeps Arkiv in memory, D-114). Through the services:
 *   a lot listed by API, agents bid, the keeper settles, every winner collects through the API handover;
 *   then on Rabdi: the lot (status follows), every bid, the price (matches LotSettled), the seller's reputation
 *   (matches SellerRecordUpdated), owners and lifetimes; the seller advice cites the ledger; a short-lived probe entity
 *   disappears at its $expiresAt. `pnpm e2e:arkiv`. TEST MONEY.
 */
import { continuousClearingAuctionAbi, lotFactoryAbi, marketSettlementAbi } from "@fairtown/shared/abi"
import { loadDeployment } from "@fairtown/shared/addresses"
import { ARKIV_SCHEMAS as S } from "@fairtown/shared/arkiv"
import { parseEventLogs, type AbiEvent, type Address, type Hash, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { LiveArkivStore } from "../../services/agents/src/arkiv/LiveArkivStore"
import { API, env, Run, startStack } from "./stack"

const run = new Run("e2e-arkiv", "base-sepolia")
console.log("Fairtown e2e:arkiv on Base Sepolia + live Rabdi (TEST MONEY)")
for (const k of ["ARKIV_ACCESS_KEY", "ARKIV_PRIVATE_KEY", "SELLER_PIN"]) if (!env[k]) throw new Error(`${k} is unset`)
const dep = await loadDeployment("base-sepolia")
const settlement = dep.contracts.MarketSettlement as Address
const writer = privateKeyToAccount((env.ARKIV_PRIVATE_KEY!.startsWith("0x") ? env.ARKIV_PRIVATE_KEY : `0x${env.ARKIV_PRIVATE_KEY}`) as Hex)
const store = new LiveArkivStore({ accessKey: env.ARKIV_ACCESS_KEY!, writer })
const { pub, logsClient } = await startStack(run)
const lc = (a: string) => a.toLowerCase()
const ev = (abi: readonly unknown[], name: string) => (abi as AbiEvent[]).find((x) => x.type === "event" && x.name === name)!
const get = async <T>(path: string) => (await (await fetch(`${API}${path}`)).json()) as T
async function post<T>(path: string, body: object, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const json = (await res.json()) as T & { error?: { code: string; message: string } }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`)
  return json
}
const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  return msg
}

// 1. A lot through the API; agents bid; the keeper settles and claims.
const d = await post<{ draftId: string }>("/api/listings/draft", { sellerId: "ingrid", text: "60 kg cod, Bergen" })
const c = await post<{ lotId: string; auction: Address; tx: Hash }>("/api/listings/confirm", { draftId: d.draftId, floorPerUnit: "7500000", durationBlocks: 450 })
const lotId = BigInt(c.lotId)
const listReceipt = await pub.waitForTransactionReceipt({ hash: c.tx })
const [listed] = parseEventLogs({ abi: lotFactoryAbi, logs: listReceipt.logs, eventName: "LotListed" })
const seller = lc(listed!.args.seller) as Address
run.say(`ok  lot ${lotId} listed on Base Sepolia, auction ${c.auction}, ends at block ${listed!.args.endBlock}`)
const settledLog = await run.until("LotSettled", 12 * 60_000, async () => {
  const head = await pub.getBlockNumber()
  if (head < listed!.args.endBlock) return undefined
  return (await run.logsIn(logsClient, settlement, ev(marketSettlementAbi, "LotSettled"), listReceipt.blockNumber, head, { lotId }))[0]
}, 5_000)
const [settledEv] = parseEventLogs({ abi: marketSettlementAbi, logs: [settledLog], eventName: "LotSettled" })
const s = settledEv!.args
run.say(`ok  settled: final ${s.finalClearingPerUnit}, average ${s.avgPerUnit}, ${s.soldUnits} kg`)
const winners = await run.until("claimed winners", 5 * 60_000, async () => {
  const v = await get<{ winners?: { buyer: Address; tokenAmount: string }[] }>(`/api/lots/${lotId}`)
  return v.winners?.length ? v.winners : undefined
}, 5_000)

// 2. Every winner collects through the API (seller session ticket, receiver confirm): paid in full.
const session = await post<{ token: string }>("/api/sessions/seller", { sellerId: "ingrid", pin: env.SELLER_PIN })
for (const w of winners) {
  const t = await post<{ ticket: object }>("/api/handover/ticket", { sellerId: "ingrid", lotId: c.lotId, buyer: w.buyer, tokenAmount: w.tokenAmount }, session.token)
  await post("/api/handover/confirm", { receiverId: w.buyer, ticket: t.ticket })
}
await run.until("paid in full", 3 * 60_000, async () => ((await get<{ status: string }>(`/api/lots/${lotId}`)).status === "paid_in_full" ? true : undefined), 3_000)
const head = await pub.getBlockNumber()
const recLog = (await run.logsIn(logsClient, settlement, ev(marketSettlementAbi, "SellerRecordUpdated"), listReceipt.blockNumber, head, { seller })).at(-1)
const [rec] = parseEventLogs({ abi: marketSettlementAbi, logs: [recLog!], eventName: "SellerRecordUpdated" })
run.say(`ok  ${winners.length} handover(s) through the API, paid in full; seller record clean ${rec!.args.cleanLots}, no-shows ${rec!.args.noShows}`)
const bidCount = (await run.logsIn(logsClient, c.auction, ev(continuousClearingAuctionAbi, "BidSubmitted"), listReceipt.blockNumber, head)).length

// 3. The public record on Rabdi.
const rabdiHead = Number(await store.reader.getBlockNumber())
const owners = new Set([seller, lc(writer.address)])
const lot = await run.until("lot entity, paid in full", 3 * 60_000, async () => {
  const [e] = (await store.query(S.lot, { lotId, auction: lc(c.auction) as Address })).entities
  return e?.values.status === "paid_in_full" ? e : undefined
}, 5_000)
run.ok([
  must(owners.has(lc(lot.owner)), `lot entity ${lot.key}: status paid_in_full, owner ${lot.owner} (seller agent or writer)`),
  must(lot.expiresAt > rabdiHead, `lot entity expires at Rabdi block ${lot.expiresAt} (head ${rabdiHead})`),
])
const bids = await run.until(`${bidCount} bid entities`, 3 * 60_000, async () => {
  const p = await store.query(S.bid, { lotId, block: { gte: listReceipt.blockNumber } }, { limit: 100 })
  return p.entities.length >= bidCount ? p.entities : undefined
}, 5_000)
run.ok([must(bids.length === bidCount, `${bids.length} bid entities = ${bidCount} BidSubmitted on chain (bid lifetimes now whole 2 s blocks)`)])
const [price] = (await store.query(S.price, { lotId, finalClearingPerUnit: s.finalClearingPerUnit, avgPerUnit: s.avgPerUnit, soldUnits: s.soldUnits })).entities
run.ok([
  must(price !== undefined && String(price.values.tx).toLowerCase() === lc(settledLog.transactionHash!), `price entity ${price?.key} matches LotSettled (final, average, sold, tx)`),
  must(lc(price!.owner) === lc(writer.address), `price owned by the writer ${writer.address}; schema flags readonly=${S.price.flags.readonly}`),
])
const rep = await run.until("reputation entity", 3 * 60_000, async () => {
  const p = await store.query(S.reputation, { seller }, { limit: 100 })
  return p.entities.find((e) => String(e.values.tx).toLowerCase() === lc(recLog!.transactionHash!))
}, 5_000)
run.ok([must(rep.values.cleanLots === BigInt(rec!.args.cleanLots) && rep.values.noShows === BigInt(rec!.args.noShows), `reputation ${rep.key}: clean ${rep.values.cleanLots}, no-shows ${rep.values.noShows}, tier ${rep.values.tier} = SellerRecordUpdated`)])

// 4. The seller advice cites the ledger.
const advice = await get<{ advice: string; basis: unknown }>("/api/sellers/ingrid/advice")
const basis = JSON.stringify(advice.basis)
run.ok([must(advice.advice.length > 0 && basis.length > 2, `advice: "${advice.advice.slice(0, 90)}" basis ${basis.slice(0, 120)}`)])

// 5. Lifetimes are real: a short-lived test lot (lot id 0, status e2e_probe: no app query matches it) is gone after
//    its $expiresAt.
run.stop()
await new Promise((r) => setTimeout(r, 3_000)) // let the agents service release the writer key
const probeSchema = S.lot
const probe = await store.put(probeSchema, { ...lot.values, lotId: 0n, status: "e2e_probe" }, { owner: writer.address, expiresInSeconds: 60 })
const probeEntity = await store.get(probeSchema, probe.key)
must(probeEntity !== undefined, `probe ${probe.key} readable after create`)
run.say(`ok  probe ${probe.key} written, expires at Rabdi block ${probeEntity!.expiresAt}`)
await run.until("probe gone after $expiresAt", 4 * 60_000, async () => ((await store.get(probeSchema, probe.key).catch(() => undefined)) === undefined ? true : undefined), 5_000)
run.ok([`probe gone at Rabdi block ${await store.reader.getBlockNumber()} (expired)`])

console.log(`\nE2E ARKIV PASSED in ${((Date.now() - run.started) / 1000).toFixed(0)}s`)
console.log(`  Arkiv keys: lot ${lot.key}, price ${price!.key}, reputation ${rep.key}`)
console.log(`  Explorer: https://rabdi.explorer.arkiv.network/entity/${price!.key}`)
process.exit(0)
