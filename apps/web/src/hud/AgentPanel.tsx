import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "../net/api"
import { useTown } from "../state/townStore"
import { formatMoney } from "../money/format"
import { AddressLink } from "./links"
import { asCurrency } from "./model"
import { PixelPerson } from "./PixelPerson"

const AgentDetails = z.looseObject({
  persona: z.string().optional(),
  currency: z.string().optional(),
  budget: z.string().regex(/^\d+$/).optional(),
  mandate: z
    .looseObject({ commodities: z.array(z.string()).optional(), maxPerUnit: z.string().regex(/^\d+$/).optional() })
    .optional(),
})

export function AgentPanel({ agentId }: { agentId: string }) {
  const agent = useTown((s) => s.town.agents[agentId])
  const view = useQuery({ queryKey: ["agent", agentId], queryFn: () => api.agent({ params: { agentId } }) })
  const details = AgentDetails.safeParse(view.data).data
  const currency = asCurrency(details?.currency ?? "")
  const max = details?.mandate?.maxPerUnit
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <PixelPerson id={agentId} role={agent?.role ?? "NONE"} size={40} />
        <h2 className="text-xl">{agent?.ensName ?? agent?.name ?? agentId}</h2>
      </div>
      <p className="text-sm text-ink-soft">
        {agent?.role ?? "Agent"} · {agent?.building ?? "unknown"} · <AddressLink address={agentId} />
      </p>
      {view.isError && <p className="text-xs text-brick">Agent details unavailable</p>}
      {details?.persona && <p className="text-sm">{details.persona}</p>}
      {details?.mandate?.commodities && (
        <p className="text-sm" title="GET /api/agents/:agentId mandate">
          {details.mandate.commodities.join(", ")}
          {max && currency ? ` up to ${formatMoney(BigInt(max), currency)} per unit` : ""}
        </p>
      )}
      {details?.budget && currency && (
        <p className="text-sm">
          <span className="text-ink-soft">Budget </span>
          <span title="GET /api/agents/:agentId budget">{formatMoney(BigInt(details.budget), currency)}</span>
        </p>
      )}
      <section aria-label="Reasons">
        <h3 className="text-xs text-ink-soft">Recent reasons</h3>
        <ul className="list-disc pl-4 text-sm">
          {(agent?.reasons ?? []).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
