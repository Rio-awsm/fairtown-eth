import type { Sector } from "@fairtown/shared"
import { z } from "zod"
import type { ProtocolParams } from "./chain/types"

const port = z.coerce.number().int().min(1).max(65535)
const bps = z.coerce.number().int().min(0).max(10000)
// ICR-003 / D-50: Base Sepolia runs ~5 blocks/s, so block windows are x10 the SoT 14 values.
const blocks = z.coerce.bigint().positive()

export const AgentsConfig = z.object({
  AGENTS_PORT: port.default(8787),
  CHAIN_MODE: z.enum(["fake", "anvil", "base-sepolia"]).default("fake"),
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  ARKIV_MODE: z.enum(["live", "memory"]).default("memory"),
  MOCK_AI: z
    .enum(["0", "1"])
    .default("1")
    .transform((v) => v === "1"),
  FEE_BPS: bps.default(100),
  ADVANCE_NEW_BPS: bps.default(5000),
  ADVANCE_PROVEN_BPS: bps.default(9000),
  ADVANCE_TRUCK_BPS: bps.default(1000),
  PROVEN_AFTER_CLEAN_LOTS: z.coerce.number().int().positive().default(3),
  CONTEST_WINDOW_BLOCKS: blocks.default(600n),
  REPORT_WINDOW_BLOCKS: blocks.default(3000n),
  PICKUP_WINDOW_FISH: blocks.default(3000n),
  PICKUP_WINDOW_FLOWERS: blocks.default(3000n),
  PICKUP_WINDOW_PRODUCE: blocks.default(4500n),
  PICKUP_WINDOW_TRUCK: blocks.default(3000n),
  PICKUP_WINDOW_STORAGE: blocks.default(1500n),
  PICKUP_WINDOW_COMPUTE: blocks.default(600n),
  RELIST_STEP_BPS: bps.default(1500),
  AGENT_MNEMONIC: z.string().optional(),
  RPC_URL: z.string().url().optional(),
  RPC_WS_URL: z.string().optional(),
  OPERATOR_PRIVATE_KEY: z.string().optional(),
  RELAY_PORT: port.default(8788),
  RELAY_INTERNAL_TOKEN: z.string().default("change-me"),
  ARKIV_ACCESS_KEY: z.string().optional(),
  ARKIV_PRIVATE_KEY: z.string().optional(),
  STORAGE_DIR: z.string().default("./.data"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),
  TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
})
export type AgentsConfig = z.infer<typeof AgentsConfig>

export class ConfigError extends Error {}

export function parseConfig(env: Record<string, string | undefined>): AgentsConfig {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const r = AgentsConfig.safeParse(clean)
  if (r.success) return r.data
  const keys = [...new Set(r.error.issues.map((i) => String(i.path[0])))]
  throw new ConfigError(`Invalid env: ${keys.join(", ")}`)
}

export const protocolParams = (c: AgentsConfig): ProtocolParams => ({
  feeBps: BigInt(c.FEE_BPS),
  advanceNewBps: c.ADVANCE_NEW_BPS,
  advanceProvenBps: c.ADVANCE_PROVEN_BPS,
  advanceTruckBps: c.ADVANCE_TRUCK_BPS,
  provenAfter: c.PROVEN_AFTER_CLEAN_LOTS,
  contestWindowBlocks: c.CONTEST_WINDOW_BLOCKS,
  reportWindowBlocks: c.REPORT_WINDOW_BLOCKS,
})

export const pickupWindowFor = (c: AgentsConfig, sector: Sector): bigint =>
  ({
    fish: c.PICKUP_WINDOW_FISH,
    flowers: c.PICKUP_WINDOW_FLOWERS,
    produce: c.PICKUP_WINDOW_PRODUCE,
    truck: c.PICKUP_WINDOW_TRUCK,
    storage: c.PICKUP_WINDOW_STORAGE,
    compute: c.PICKUP_WINDOW_COMPUTE,
  })[sector]
