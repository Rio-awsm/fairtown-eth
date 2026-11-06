import type { CreateBuyerRequest } from "@fairtown/shared/api"
import { BUILDINGS, type Building, type Currency } from "@fairtown/shared/keys"
import { parseUnits } from "viem"
import type { z } from "zod"
import type { Selection } from "../game/EventBus"
import { formatMoney } from "../money/format"
import { parseFloorInput } from "../sell/model"

/** Buyer console (S3 3.1) logic, kept pure. Money is typed in plain units and sent as bigint base units. */

export type BuyerForm = {
  name: string
  role: "BUYER" | "SOCIETY"
  currency: Currency
  commodities: string[]
  maxPerUnit: string
  qty: string
  minGrade: string
  place: string
  budget: string
  avoidNoShowSellers: boolean
}
type Body = z.input<typeof CreateBuyerRequest>
export type BuildResult = { ok: true; body: Body } | { ok: false; errors: Partial<Record<keyof BuyerForm, string>> }

function parseBudget(input: string): { ok: true; value: bigint } | { ok: false; error: string } {
  const text = input.trim().replace(/,/g, "")
  if (text === "") return { ok: false, error: "Enter a budget" }
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return { ok: false, error: "Enter an amount like 50000" }
  const value = parseUnits(text, 6)
  if (value < 1_000_000n) return { ok: false, error: "The smallest budget is 1.00" }
  return { ok: true, value }
}

/** Validates the create form and builds `POST /api/buyers`. Every problem is named. */
export function buildBuyerRequest(form: BuyerForm): BuildResult {
  const errors: Partial<Record<keyof BuyerForm, string>> = {}
  const name = form.name.trim()
  if (name === "") errors.name = "Give the buyer a name"
  if (form.commodities.length === 0) errors.commodities = "Pick at least one thing to buy"
  const max = parseFloorInput(form.maxPerUnit)
  if (!max.ok) errors.maxPerUnit = max.error
  const qtyText = form.qty.trim()
  if (qtyText !== "" && !/^[1-9]\d*$/.test(qtyText)) errors.qty = "Use a whole number"
  const budget = parseBudget(form.budget)
  if (!budget.ok) errors.budget = budget.error
  if (max.ok && budget.ok && qtyText !== "" && !errors.qty) {
    const needed = max.value * BigInt(qtyText)
    if (budget.value < needed)
      errors.budget = `The budget is less than max price × quantity (${formatMoney(needed, form.currency)})`
  }
  if (Object.keys(errors).length > 0 || !max.ok || !budget.ok) return { ok: false, errors }
  return {
    ok: true,
    body: {
      name,
      role: form.role,
      currency: form.currency,
      mandate: {
        commodities: form.commodities as Body["mandate"]["commodities"],
        maxPerUnit: max.value.toString(),
        ...(qtyText ? { qty: qtyText } : {}),
        ...(form.minGrade ? { minGrade: form.minGrade as NonNullable<Body["mandate"]["minGrade"]> } : {}),
        ...(form.place ? { place: form.place as NonNullable<Body["mandate"]["place"]> } : {}),
        avoidNoShowSellers: form.avoidNoShowSellers,
      },
      budget: budget.value.toString(),
    },
  }
}

/** `/town?select=agent:<id>` (or `lot:<id>`, `building:<name>`): what "Watch in town" opens. */
export function parseSelectParam(param: string | null): Selection {
  const [kind, ...rest] = (param ?? "").split(":")
  const id = rest.join(":")
  if (!id) return null
  if (kind === "agent" || kind === "lot") return { kind, id }
  if (kind === "building" && (BUILDINGS as readonly string[]).includes(id)) return { kind, id: id as Building }
  return null
}
