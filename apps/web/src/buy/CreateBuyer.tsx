import { COMMODITIES, CURRENCIES, GRADES, PLACES, type Currency } from "@fairtown/shared/keys"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "../net/api"
import { buildBuyerRequest, type BuyerForm } from "./model"

const EMPTY: BuyerForm = {
  name: "",
  role: "BUYER",
  currency: "EUR",
  commodities: [],
  maxPerUnit: "",
  qty: "",
  minGrade: "",
  place: "",
  budget: "",
  avoidNoShowSellers: true,
}
const field = "rpg-input mt-2 w-full"

/** New buyer agent: mandate and budget in plain money (S3 3.1). */
export function CreateBuyer({ onCreated }: { onCreated(agentId: string): void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<BuyerForm>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof BuyerForm, string>>>({})
  const set = <K extends keyof BuyerForm>(k: K, v: BuyerForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createBuyer>[0] & object) => api.createBuyer(body),
    onSuccess: (res, vars) => {
      const view = { agentId: res.agentId, address: res.address, ...vars.body, paused: false }
      queryClient.setQueryData(["agent", res.agentId], view)
      queryClient.setQueryData(["agents"], (old: unknown[] | undefined) => [...(old ?? []), view])
      onCreated(res.agentId)
    },
  })
  const submit = () => {
    const built = buildBuyerRequest(form)
    if (!built.ok) return setErrors(built.errors)
    setErrors({})
    create.mutate({ body: built.body })
  }
  const err = (k: keyof BuyerForm) => errors[k] && <p className="text-sm text-gold-ink">{errors[k]}</p>
  return (
    <form
      aria-label="New buyer"
      className="rpg-window space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <h2 className="text-xl font-bold">New buyer</h2>
      <label className="block">
        Name
        <input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} />
      </label>
      {err("name")}
      <fieldset className="flex gap-4">
        <legend className="text-sm">Who</legend>
        {(["BUYER", "SOCIETY"] as const).map((r) => (
          <label key={r}>
            <input type="radio" name="role" checked={form.role === r} onChange={() => set("role", r)} />{" "}
            {r === "BUYER" ? "Business" : "Housing society"}
          </label>
        ))}
      </fieldset>
      <label className="block">
        Currency
        <select className={field} value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="text-sm">What to buy</legend>
        <div className="grid grid-cols-3 gap-1">
          {COMMODITIES.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={form.commodities.includes(c)}
                onChange={(e) =>
                  set(
                    "commodities",
                    e.target.checked ? [...form.commodities, c] : form.commodities.filter((x) => x !== c),
                  )
                }
              />{" "}
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      {err("commodities")}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          Max price per unit
          <input
            className={field}
            inputMode="decimal"
            value={form.maxPerUnit}
            onChange={(e) => set("maxPerUnit", e.target.value)}
          />
          {err("maxPerUnit")}
        </label>
        <label className="block">
          Quantity
          <input className={field} inputMode="numeric" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
          {err("qty")}
        </label>
        <label className="block">
          Lowest grade
          <select className={field} value={form.minGrade} onChange={(e) => set("minGrade", e.target.value)}>
            <option value="">Any</option>
            {GRADES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="block">
          Place
          <select className={field} value={form.place} onChange={(e) => set("place", e.target.value)}>
            <option value="">Anywhere</option>
            {PLACES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        Budget
        <input
          className={field}
          inputMode="decimal"
          value={form.budget}
          onChange={(e) => set("budget", e.target.value)}
        />
      </label>
      {err("budget")}
      <label className="block">
        <input
          type="checkbox"
          checked={form.avoidNoShowSellers}
          onChange={(e) => set("avoidNoShowSellers", e.target.checked)}
        />{" "}
        Avoid sellers with no-shows
      </label>
      {create.isError && (
        <p role="alert" className="text-gold-ink">
          We could not create the buyer. Please try again.
        </p>
      )}
      <button type="submit" className="rpg-btn rpg-btn-go w-full" disabled={create.isPending}>
        Create buyer
      </button>
    </form>
  )
}
