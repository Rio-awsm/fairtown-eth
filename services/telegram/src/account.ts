import type { Bot } from "grammy"
import { type AgentsClient } from "./agents"
import { lotLine } from "./buy"
import { explain, ID_TEXT, uid } from "./identity"
import type { Links } from "./links"
import type { Log } from "./log"
import type { Market } from "./market"
import { formatMoney } from "./money"

// TG 1.3: your lots, your profile and the seller's price advice. Read-only.
export type AccountDeps = { agents: AgentsClient; links: Links; market: Market; log: Log }

export const ACCOUNT_TEXT = {
  signIn: "Sign in first: /link for sellers and drivers, /join for buyers.",
  noLots: "No lots yet. List one with /sell.",
  noBids: "You haven't bid on anything from this chat yet. See /market.",
  advice: "Price advice is for sellers. Sign in with /link.",
} as const

export function registerAccount(bot: Bot, d: AccountDeps) {
  bot.command("lots", async (ctx) => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l) return ctx.reply(ACCOUNT_TEXT.signIn)
    if (l.role === "HUMAN") {
      const ids = d.market.myLots(user)
      if (!ids.length) return ctx.reply(ACCOUNT_TEXT.noBids)
      const rows = ids.map((id) => d.market.lots.get(id)).filter((x) => x !== undefined)
      return ctx.reply(["Lots you bid on:", ...rows.map((r) => `${lotLine(r)} (${r.status.replace(/_/g, " ")})`)].join("\n"))
    }
    // The relay knows every lot in town, including ones listed by the seller's agent; newest first.
    const mine = [...d.market.lots.values()].filter((r) => r.seller === l.address.toLowerCase()).sort((a, b) => Number(BigInt(b.lotId) - BigInt(a.lotId))).slice(0, 10)
    if (!mine.length) return ctx.reply(ACCOUNT_TEXT.noLots)
    await ctx.reply(["Your lots:", ...mine.map((r) => `${lotLine(r)} (${r.status.replace(/_/g, " ")})`), "", "Details: /lot <number>"].join("\n"))
  })

  bot.command("profile", async (ctx) => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l) return ctx.reply(ACCOUNT_TEXT.signIn)
    try {
      if (l.role === "HUMAN") {
        const a = await d.agents.agent(user, l.agentId)
        const n = (k: string) => (typeof a[k] === "string" && /^\d+$/.test(a[k] as string) ? (a[k] as string) : undefined)
        const lines = [`${l.name}, buyer (test money in ${l.currency})`]
        if (n("budget")) lines.push(`Budget: ${formatMoney(n("budget")!, l.currency)}`)
        if (n("spent")) lines.push(`Spent: ${formatMoney(n("spent")!, l.currency)}`)
        if (n("budgetLeft")) lines.push(`Left: ${formatMoney(n("budgetLeft")!, l.currency)}`)
        const minutes = d.links.minutesLeft(user)
        lines.push(minutes === undefined ? ID_TEXT.ended(l) : `Visit ends in ${minutes} minutes.`)
        return ctx.reply(lines.join("\n"))
      }
      const p = await d.agents.sellerProfile(user, l.sellerId)
      const totals = new Map<string, bigint>() // "kind currency" -> sum, in base units
      for (const x of p.payouts ?? []) totals.set(`${x.kind}|${x.currency}`, (totals.get(`${x.kind}|${x.currency}`) ?? 0n) + BigInt(x.amount))
      const r = p.record
      return ctx.reply(
        [
          `${p.name} (${l.role === "TRUCK" ? "driver" : l.role === "STORAGE" ? "cold store" : "seller"}, id ${l.sellerId})`,
          `Tier: ${p.tier ?? "new"}${r ? `. Record: ${r.cleanLots} clean lots, ${r.noShows} no-shows${r.proven ? ", proven" : ""}` : ""}`,
          ...(totals.size ? ["Payouts:", ...[...totals].map(([k, v]) => `  ${k.split("|")[0]!.replace(/_/g, " ")}: ${formatMoney(v, k.split("|")[1]!)}`)] : ["No payouts yet."]),
        ].join("\n"),
      )
    } catch (e) {
      return ctx.reply(explain(e, d))
    }
  })

  bot.command("advice", async (ctx) => {
    const user = uid(ctx)
    const l = d.links.get(user)
    if (!l || l.role === "HUMAN") return ctx.reply(ACCOUNT_TEXT.advice)
    try {
      const a = await d.agents.advice(user, l.sellerId)
      return ctx.reply(a.advice)
    } catch (e) {
      return ctx.reply(explain(e, d))
    }
  })
}
