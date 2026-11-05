import { toBase } from "@fairtown/shared"
import { AgentView, CreateBuyerRequest, CreateBuyerResponse, PatchAgentRequest } from "@fairtown/shared/api"
import type { FastifyInstance } from "fastify"
import type { Address } from "viem"
import type { z } from "zod"
import { HttpError } from "../listing/routes"
import type { AgentRuntime } from "./runtime"

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body)
  if (!r.success) {
    const i = r.error.issues[0]!
    throw new HttpError(400, "bad_request", `${i.path.join(".") || "body"}: ${i.message}`)
  }
  return r.data
}
const MAX_CUSTOM_BUDGET = toBase("50000")

export function registerAgentRoutes(app: FastifyInstance, runtime: AgentRuntime) {
  const viewOr404 = (id: string) => {
    const v = runtime.view(id as Address)
    if (!v) throw new HttpError(404, "unknown_agent", `No agent ${id}`)
    return AgentView.parse(v)
  }

  app.get("/api/agents", async () => [...runtime.agents.keys()].map((id) => AgentView.parse(runtime.view(id))))
  app.get<{ Params: { agentId: string } }>("/api/agents/:agentId", async (req) => viewOr404(req.params.agentId))

  app.patch<{ Params: { agentId: string } }>("/api/agents/:agentId", async (req) => {
    const body = parse(PatchAgentRequest, req.body)
    if (!runtime.patch(req.params.agentId as Address, body)) throw new HttpError(404, "unknown_agent", `No agent ${req.params.agentId}`)
    return viewOr404(req.params.agentId)
  })

  // Buyer console: a new buyer agent with its own wallet, funded in its currency. Bids only through guardrails.
  app.post("/api/buyers", async (req) => {
    const body = parse(CreateBuyerRequest, req.body)
    if (!["BUYER", "SOCIETY"].includes(body.role)) throw new HttpError(400, "bad_role", "role must be BUYER or SOCIETY")
    const budget = BigInt(body.budget)
    if (budget <= 0n || budget > MAX_CUSTOM_BUDGET) throw new HttpError(400, "bad_budget", "budget must be between 0 and 50,000")
    const agent = runtime.addAgent({
      name: body.name,
      role: body.role,
      kind: "custom",
      building: "town_gate",
      sprite: "visitor",
      currency: body.currency,
      budget,
      mandate: body.mandate,
    })
    await runtime.bootstrap([agent])
    return CreateBuyerResponse.parse({ agentId: agent.agentId, address: agent.agentId })
  })
}
