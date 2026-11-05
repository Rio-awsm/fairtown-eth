import { MOCK_RESPONSES } from "./responses"

/**
 * In-memory agents for the mock API, so the buyer console behaves like the real one: a created
 * buyer appears in the list, and pause and edit stick until the page reloads.
 */
type View = Record<string, unknown> & { agentId: string; name: string; role: string }

const SHANTI = "0x000000000000000000000000000000000000010e"
const seeded = (): Map<string, View> =>
  new Map<string, View>([
    [
      SHANTI,
      {
        agentId: SHANTI,
        name: "Shanti Niwas",
        role: "SOCIETY",
        persona: "Mumbai housing society buying vegetables together",
        currency: "USD",
        mandate: { commodities: ["tomato", "onion"], maxPerUnit: "500000", avoidNoShowSellers: true },
        budget: "2000000000",
        families: [
          { name: "Flat 2B, Desai family", qty: "20" },
          { name: "Flat 4A, Khan family", qty: "15" },
          { name: "Flat 7C, Iyer family", qty: "10" },
        ],
      },
    ],
  ])

let agents = seeded()
let nextId = 0x1f0

export function resetMockAgents(): void {
  agents = seeded()
  nextId = 0x1f0
}

const base = () => MOCK_RESPONSES.agent as View

export function mockAgentList(): View[] {
  const list = MOCK_RESPONSES.agents as View[]
  return [...list, ...[...agents.values()].filter((a) => !list.some((l) => l.agentId === a.agentId))]
}

export function mockAgent(agentId: string): View {
  return agents.get(agentId.toLowerCase()) ?? { ...base(), agentId }
}

export function mockCreateBuyer(body: {
  name: string
  role: string
  currency: string
  mandate: unknown
  budget: string
}) {
  const agentId = `0x${(nextId++).toString(16).padStart(40, "0")}`
  agents.set(agentId, { agentId, ...body, paused: false })
  return { agentId, address: agentId }
}

export function mockPatchAgent(agentId: string, patch: { mandate?: Record<string, unknown>; paused?: boolean }): View {
  const current = mockAgent(agentId)
  const next: View = {
    ...current,
    ...(patch.paused === undefined ? {} : { paused: patch.paused }),
    ...(patch.mandate ? { mandate: { ...(current.mandate as object), ...patch.mandate } } : {}),
  }
  agents.set(agentId.toLowerCase(), next)
  return next
}
