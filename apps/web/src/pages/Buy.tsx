import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AgentDetail } from "../buy/AgentDetail"
import { CreateBuyer } from "../buy/CreateBuyer"
import { api } from "../net/api"
import { useTown } from "../state/townStore"
import { PixelPerson } from "../hud/PixelPerson"

const BUYER_ROLES = new Set(["BUYER", "SOCIETY", "HUMAN"])

/** Buyer console (S3 3.1): agents from the API and the town, create, and one agent's detail. */
export function BuyPage() {
  const townAgents = useTown((s) => s.town.agents)
  const list = useQuery({ queryKey: ["agents"], queryFn: () => api.agents() })
  const [selected, setSelected] = useState<string | "new" | null>(null)
  const merged = new Map<string, { agentId: string; name: string; role: string; paused?: boolean }>()
  for (const a of list.data ?? [])
    if (BUYER_ROLES.has(a.role)) merged.set(a.agentId.toLowerCase(), { ...a, paused: a.paused === true })
  for (const a of Object.values(townAgents))
    if (BUYER_ROLES.has(a.role) && !merged.has(a.agentId.toLowerCase())) merged.set(a.agentId.toLowerCase(), a)
  return (
    <section className="mx-auto max-w-6xl space-y-3 p-4">
      <h1 className="rpg-banner">Buyer console</h1>
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <nav aria-label="Buyers" className="space-y-2">
          <button className="rpg-btn rpg-btn-go w-full" onClick={() => setSelected("new")}>
            New buyer
          </button>
          {list.isError && <p role="alert">We could not load the buyer list.</p>}
          {[...merged.values()].map((a) => (
            <button
              key={a.agentId}
              className={`rpg-window rpg-card flex items-center gap-3 p-3 ${selected === a.agentId ? "bg-coin-light" : ""}`}
              onClick={() => setSelected(a.agentId)}
            >
              <PixelPerson
                id={a.agentId}
                role={a.role === "SOCIETY" || a.role === "HUMAN" ? a.role : "BUYER"}
                size={32}
              />
              <span>
                <span className="block font-bold">{a.name}</span>
                <span className="text-sm text-ink-soft">
                  {a.role === "SOCIETY" ? "Housing society" : a.role === "HUMAN" ? "Visitor" : "Business"}
                  {a.paused ? " · paused" : ""}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div>
          {selected === "new" && <CreateBuyer onCreated={setSelected} />}
          {selected && selected !== "new" && <AgentDetail key={selected} agentId={selected} />}
          {!selected && <p className="rpg-window p-4">Pick a buyer, or create one.</p>}
        </div>
      </div>
    </section>
  )
}
