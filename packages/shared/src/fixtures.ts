import { z } from "zod"
import { Mandate } from "./api"
import { BUILDINGS, COMMODITIES, CURRENCIES, PLACES, ROLE_NAMES, SECTORS } from "./keys"
import { Dec } from "./units"

export const SCENES = ["bergen_cod", "dallas_return", "gpu_night", "diwali_marigold", "rose_flight", "lagos_cold", "no_show"] as const
export const PERSONA_KINDS = ["seller", "buyer", "truck", "cold_store", "society", "compute_provider"] as const

export const Persona = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  role: z.enum(ROLE_NAMES),
  kind: z.enum(PERSONA_KINDS),
  building: z.enum(BUILDINGS),
  sprite: z.string(),
  place: z.enum(PLACES),
  currency: z.enum(CURRENCIES),
  budget: Dec,
  sectors: z.array(z.enum(SECTORS)).min(1),
  mandate: Mandate.optional(),
  seeded: z.object({ proven: z.boolean().optional(), noShow: z.boolean().optional() }).optional(),
  scenes: z.array(z.enum(SCENES)).min(1),
  bio: z.string().max(140),
  fixtureAgentId: z.string().regex(/^0x[0-9a-f]{40}$/),
})
export type Persona = z.infer<typeof Persona>

export const SellerMessage = z.object({
  id: z.string(),
  sellerId: z.string(),
  text: z.string().min(1),
  expected: z.object({
    sector: z.enum(SECTORS),
    commodity: z.enum(COMMODITIES),
    qty: Dec,
    unit: z.string(),
    place: z.enum(PLACES),
    currency: z.enum(CURRENCIES),
  }),
  hard: z.boolean(),
})
export type SellerMessage = z.infer<typeof SellerMessage>

export const FIXTURE_FILES = { day: "day.jsonl", agents: "agents.json", messages: "messages.json" } as const
export const fixtureUrl = (name: keyof typeof FIXTURE_FILES) => new URL(`../fixtures/${FIXTURE_FILES[name]}`, import.meta.url)
