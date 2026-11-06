import type { Hex } from "viem"
import { networkConfig, requireKey, type Env, type Network } from "./lib"

/** D-54 (amends D-15): checkpoint a live auction with bids when 25 blocks (~5 s on Base) passed without one. */
export const DEFAULT_CHECKPOINT_BLOCKS = 25n
export const POLL_MS = 1_000
/** First getLogs range when catching up; halved on "range too large" errors, down to MIN_LOG_CHUNK. */
export const LOG_CHUNK = 2_000n
export const MIN_LOG_CHUNK = 50n

export type KeeperConfig = {
  network: Network
  rpcUrl: string
  explorer: string
  keeperKey: Hex
  checkpointEvery: bigint
  pollMs: number
}

/**
 * Keeper settings from env. The network comes from the CLI argument, else CHAIN_MODE. Errors name the variable,
 * never its value.
 */
export function keeperConfig(env: Env, arg?: string): KeeperConfig {
  const mode = arg ?? env.CHAIN_MODE
  if (mode === "fake") throw new Error("CHAIN_MODE=fake has no chain for the keeper. Use anvil or base-sepolia")
  const net = networkConfig(mode, env)
  return {
    ...net,
    keeperKey: requireKey(env, "KEEPER_PRIVATE_KEY"),
    checkpointEvery: parseBlocks(env.KEEPER_CHECKPOINT_BLOCKS, "KEEPER_CHECKPOINT_BLOCKS", DEFAULT_CHECKPOINT_BLOCKS),
    pollMs: POLL_MS,
  }
}

function parseBlocks(raw: string | undefined, name: string, fallback: bigint): bigint {
  if (raw === undefined || raw.trim() === "") return fallback
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole number of blocks`)
  const n = BigInt(raw.trim())
  if (n < 1n || n > 100_000n) throw new Error(`${name} must be between 1 and 100000`)
  return n
}
