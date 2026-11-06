import { z } from "zod"

export const RelayConfig = z.object({
  RELAY_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:8080"),
  CORS_ORIGINS: z.string().optional(),
  RELAY_INTERNAL_TOKEN: z.string().min(1),
  CHAIN_MODE: z.enum(["fake", "anvil", "base-sepolia"]).default("fake"),
  RPC_URL: z.string().url().optional(),
  RPC_WS_URL: z.string().optional(),
  LOGS_RPC_URL: z.string().url().optional(),
  // Restart lookback in blocks, as in the agents service (default 20,000 in the watcher). Anvil runs use 1: a fork
  // forwards pre-fork getLogs to its upstream RPC, which rejects wide ranges (C 1.2).
  CHAIN_BACKFILL_BLOCKS: z.coerce.bigint().positive().optional(),
})
export type RelayConfig = z.infer<typeof RelayConfig>

export function parseRelayConfig(env: Record<string, string | undefined>): RelayConfig {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const r = RelayConfig.safeParse(clean)
  if (r.success) return r.data
  throw new Error(`Invalid env: ${[...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ")}`)
}
