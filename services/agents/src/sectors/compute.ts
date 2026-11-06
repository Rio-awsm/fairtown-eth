import type { Address } from "viem"

// SIMULATED provider (SoT scene 3, honest label): no real GPU is reserved. The auction and the money are real on testnet.
export const SIMULATED_LABEL = "Simulated GPU provider"

export type AccessRecord = {
  lotId: bigint
  buyer: Address
  gpuHours: bigint
  endpoint: string
  issuedAtBlock: bigint
  simulated: true
  label: typeof SIMULATED_LABEL
}

export function issueAccess(lotId: bigint, buyer: Address, gpuHours: bigint, block: bigint): AccessRecord {
  return { lotId, buyer, gpuHours, endpoint: `sim://northlight/lot-${lotId}/${buyer.slice(2, 10)}`, issuedAtBlock: block, simulated: true, label: SIMULATED_LABEL }
}

// Mock health check the buyer agent runs before confirming. Deterministic: fails only when the scenario says so.
export function healthCheck(r: AccessRecord, failing: ReadonlySet<string>): { ok: boolean; detail: string } {
  if (failing.has(r.lotId.toString())) return { ok: false, detail: `${r.endpoint} did not answer the health check` }
  return { ok: r.gpuHours > 0n && r.endpoint.startsWith("sim://"), detail: `${r.endpoint} healthy, ${r.gpuHours} GPU hours` }
}
