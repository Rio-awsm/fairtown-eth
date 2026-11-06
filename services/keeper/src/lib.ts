import { BaseError, ContractFunctionRevertedError, custom, type Hex, type Transport } from "viem"
import { splitPayout } from "@fairtown/shared/units"
// One reviewed .env loader for the repo (C 0.1, D-34): Node's parseEnv plus a ${VAR} expander.
export { loadEnv } from "@fairtown/shared/env"

export type Env = Record<string, string | undefined>
export const NETWORKS = ["anvil", "base-sepolia"] as const
export type Network = (typeof NETWORKS)[number]
export const ANVIL_RPC = "http://127.0.0.1:8545"

/** Fixed AGENT_MNEMONIC indexes reserved for the smoke run (D-49), so wallets are reused across runs. */
export const SMOKE_INDEX = { seller: 90, buyer1: 91, buyer2: 92 } as const
export const SMOKE_MIN_GAS_WEI = 3_000_000_000_000_000n // 0.003 ETH

export type NetworkConfig = { network: Network; rpcUrl: string; explorer: string }

/** Errors name the variable, never its value (RPC URLs can carry API keys). */
export function networkConfig(arg: string | undefined, env: Env): NetworkConfig {
  if (!arg || !(NETWORKS as readonly string[]).includes(arg)) {
    throw new Error(`Usage: smoke <${NETWORKS.join(" | ")}>`)
  }
  const network = arg as Network
  const rpcUrl = network === "anvil" ? env.ANVIL_RPC_URL || ANVIL_RPC : env.RPC_URL
  if (!rpcUrl) throw new Error("RPC_URL is unset. Fill it in .env")
  if (!/^https?:\/\//.test(rpcUrl)) throw new Error("RPC URL must be http(s)")
  return { network, rpcUrl, explorer: env.EXPLORER_URL || "https://sepolia.basescan.org" }
}

export function requireKey(env: Env, name: string): Hex {
  const v = env[name]
  if (!v) throw new Error(`${name} is unset`)
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be 0x followed by 64 hex characters`)
  return v as Hex
}

export function requireMnemonic(env: Env): string {
  const m = env.AGENT_MNEMONIC?.trim()
  if (!m) throw new Error("AGENT_MNEMONIC is unset")
  const words = m.split(/\s+/).length
  if (![12, 15, 18, 21, 24].includes(words)) throw new Error("AGENT_MNEMONIC must have 12 to 24 words")
  return m
}

/** What settle must pay, from the same math as Solidity PriceMath (vectors in packages/shared/fixtures). */
export function expectedSettle(raised: bigint, feeBps: bigint, advanceBps: bigint) {
  return splitPayout(raised, feeBps, advanceBps)
}

export type CheckpointView = { block: bigint; clearingPrice: bigint; prev: bigint }

/**
 * CCA exitPartiallyFilledBid hints (S1 1.2 NOTES). Walk checkpoints back from the final one:
 * outbidBlock = earliest checkpoint with clearing > maxPrice (0n if final clearing == maxPrice),
 * lastFullyFilled = latest checkpoint with clearing < maxPrice. `get` reads one checkpoint by block.
 * The end block must be checkpointed first, or the hints are stale.
 */
export async function exitHints(
  maxPrice: bigint,
  lastCheckpointed: bigint,
  get: (block: bigint) => Promise<CheckpointView>,
): Promise<{ lastFullyFilled: bigint; outbid: bigint }> {
  let outbid = 0n
  let b = lastCheckpointed
  while (b !== 0n) {
    const cp = await get(b)
    if (cp.clearingPrice > maxPrice) outbid = b
    if (cp.clearingPrice < maxPrice) return { lastFullyFilled: b, outbid }
    b = cp.prev
  }
  throw new Error("No fully filled checkpoint before the bid")
}

export const txLink = (explorer: string, hash: string) => `${explorer.replace(/\/$/, "")}/tx/${hash}`
export const addressLink = (explorer: string, address: string) => `${explorer.replace(/\/$/, "")}/address/${address}`

export const REDACTED_RPC = "<RPC_URL>"

/** Replaces every secret (RPC URL, keys) in text. Empty secrets are ignored. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text
  for (const s of secrets) if (s) out = out.split(s).join(REDACTED_RPC)
  return out
}

/**
 * One-line, secret-free description of a failure. viem errors embed the request URL (and with it any RPC API
 * key) in their full message, so only shortMessage and details are used, then redacted.
 */
export function safeErrorMessage(e: unknown, secrets: (string | undefined)[]): string {
  let msg: string
  if (e instanceof BaseError) {
    msg = e.details ? `${e.shortMessage} (${e.details})` : e.shortMessage
    // Surface the revert reason: decoded error name, or the raw 4-byte selector for errors outside the ABI.
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    if (rev?.data?.errorName) msg += ` [${rev.data.errorName}]`
    else if (rev?.signature) msg += ` [selector ${rev.signature}]`
    else if (rev?.raw) msg += ` [raw ${rev.raw.slice(0, 10)}]`
  } else if (e instanceof Error) msg = e.message
  else msg = String(e)
  return redact(msg, secrets)
}

/**
 * Sends eth_getLogs to `logs` and everything else to `main` (C 1.1). Alchemy's free tier caps getLogs at a tiny
 * block range, so log tailing goes to LOGS_RPC_URL (public RPC, as the agents service does) when it is set.
 */
export function splitLogsTransport(main: Transport, logs: Transport | undefined): Transport {
  if (!logs) return main
  return (opts) => {
    const m = main(opts)
    const l = logs(opts)
    return custom({
      request: ({ method, params }) => (method === "eth_getLogs" ? l : m).request({ method, params } as never),
    })(opts)
  }
}

/** getLogs block-range errors from RPC providers ("eth_getLogs is limited to a 200 range", "range too large", ...). */
const RANGE_ERROR = /range|limit|too many|exceed|response size/i

/**
 * Next getLogs chunk after an RPC error: the provider's stated limit when the message names one, else half.
 * Returns undefined when the error is not about the range, or the chunk can't shrink further.
 */
export function shrinkLogChunk(message: string, chunk: bigint, min: bigint): bigint | undefined {
  if (!RANGE_ERROR.test(message) || chunk <= min) return undefined
  const stated = /limited to (?:a )?(\d+)|(\d+)[ -]block range|max(?:imum)? (?:block )?range (?:of |is )?(\d+)/i.exec(
    message,
  )
  const n = stated ? BigInt(stated[1] ?? stated[2] ?? stated[3]!) : 0n
  if (n >= min && n < chunk) return n
  return chunk / 2n >= min ? chunk / 2n : min
}
