import { z } from "zod"

const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const int = () => z.number().int()

export const NETWORKS = ["base-sepolia", "anvil"] as const
export type Network = (typeof NETWORKS)[number]

export const Deployment = z.object({
  network: z.enum(NETWORKS),
  chainId: int(),
  deployedAtBlock: int().nonnegative(),
  commit: z.string(),
  contracts: z.object({
    TestUSD: Addr,
    TestEUR: Addr,
    AgentRegistry: Addr,
    AgentRegistryHook: Addr,
    LotFactory: Addr,
    MarketSettlement: Addr,
    ChainTrigger: Addr,
    SignalOracle: Addr,
    DisputeResolver: Addr,
    CCAFactory: Addr,
  }),
  external: z.object({ Permit2: Addr, CreForwarder: Addr, CircleTestUSDC: Addr, CircleTestEURC: Addr }),
  params: z.object({
    feeBps: int(),
    advanceNewBps: int(),
    advanceProvenBps: int(),
    advanceTruckBps: int(),
    provenAfter: int(),
    contestWindowBlocks: int(),
    reportWindowBlocks: int(),
  }),
})
export type Deployment = z.infer<typeof Deployment>

export const parseDeployment = (json: unknown): Deployment => Deployment.parse(json)

const DEFAULT_DIR = new URL("../../../deployments/", import.meta.url)

export async function loadDeployment(network: Network, dir: URL = DEFAULT_DIR): Promise<Deployment> {
  const { readFile } = await import("node:fs/promises")
  const file = new URL(`${network}.json`, dir)
  let raw: string
  try {
    raw = await readFile(file, "utf8")
  } catch {
    throw new Error(`No deployment for ${network} at ${file.pathname}. Run pnpm deploy:${network} (S1 1.4).`)
  }
  const dep = parseDeployment(JSON.parse(raw))
  if (dep.network !== network) throw new Error(`${file.pathname} is for ${dep.network}, not ${network}`)
  return dep
}
