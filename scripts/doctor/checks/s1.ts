import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createPublicClient, formatEther, http, parseEther, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { parseDeployment } from "@fairtown/shared/addresses"
import { atLeast, type Check, type Env, type Result } from "../core"

export const CCA_TAG = "v2.1.0"
export const BASE_SEPOLIA_CHAIN_ID = 84532
export const MIN_DEPLOYER_WEI = parseEther("0.1")
export const MIN_KEEPER_WEI = parseEther("0.05")
export const MIN_OPERATOR_WEI = parseEther("0.01")
/** CRE simulation writes (`cre workflow simulate --broadcast`, S1 4.2): ~10 reports per W1 run at Base fees. */
export const MIN_CRE_WEI = parseEther("0.005")
export const ANVIL_RPC = "http://127.0.0.1:8545"
const RPC_TIMEOUT_MS = 8_000

export type Exec = (cmd: string, args: string[], cwd: string) => { ok: boolean; stdout: string }
export type Rpc = {
  chainId: () => Promise<number>
  balance: (a: Address) => Promise<bigint>
  code: (a: Address) => Promise<Hex | undefined>
}
export type S1Deps = { root: string; exec: Exec; rpc: (url: string) => Rpc; readFile: (path: string) => string | null }

const defaultReadFile = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

const defaultExec: Exec = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 10_000 })
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim() }
}

const defaultRpc = (url: string): Rpc => {
  const client = createPublicClient({ transport: http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 0 }) })
  return {
    chainId: () => client.getChainId(),
    balance: (address) => client.getBalance({ address }),
    code: (address) => client.getCode({ address }),
  }
}

/** Which RPC the S1 rows talk to for the active CHAIN_MODE, or null when chain rows are skipped. */
export function rpcUrlFor(env: Env): string | null {
  if (env.CHAIN_MODE === "base-sepolia") return env.RPC_URL || null
  if (env.CHAIN_MODE === "anvil") return env.FORK_RPC_URL || null
  return null
}

const live = (env: Env) => env.CHAIN_MODE === "base-sepolia" || env.CHAIN_MODE === "anvil"
const skipped = (env: Env): Result => ({ status: "warn", detail: `Skipped, CHAIN_MODE=${env.CHAIN_MODE ?? "unset"}` })

/** Never echo an RPC error: viem messages include the URL, which can carry an API key. */
const rpcFailure = (e: unknown): Result => ({
  status: "fail",
  detail: `RPC unreachable (${e instanceof Error ? e.name : "error"})`,
})

/** First x.y.z in a `--version` banner. */
export function parseVersion(out: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null
}

function toolCheck(id: string, title: string, cmd: string, min: string, major: number | null, deps: S1Deps): Check {
  return {
    id,
    owner: "S1",
    title,
    run: () => {
      const r = deps.exec(cmd, ["--version"], deps.root)
      const v = r.ok ? parseVersion(r.stdout) : null
      if (!v) return { status: "fail", detail: `${cmd} not found. See contracts/README.md` }
      if (major !== null && !v.startsWith(`${major}.`))
        return { status: "fail", detail: `${cmd} ${v}, need ${major}.x` }
      if (!atLeast(v, min)) return { status: "fail", detail: `${cmd} ${v}, need ${min} or later` }
      return { status: "ok", detail: `${cmd} ${v}` }
    },
  }
}

/** Address for a key, or an error label. Never returns or throws anything that contains the key. */
export function addressOf(key: string | undefined): { address: Address } | { error: string } {
  if (!key) return { error: "unset" }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return { error: "not a 0x-prefixed 32-byte hex key" }
  try {
    return { address: privateKeyToAccount(key as Hex).address }
  } catch {
    return { error: "invalid key" }
  }
}

export function makeS1Checks(deps: S1Deps): Check[] {
  return [
    toolCheck("forge-version", "Foundry forge 1.x", "forge", "1.0.0", 1, deps),
    toolCheck("anvil-version", "Foundry anvil 1.x", "anvil", "1.0.0", 1, deps),
    toolCheck("bun-version", "Bun 1.2+", "bun", "1.2.0", null, deps),
    {
      id: "cca-pin",
      owner: "S1",
      title: `CCA submodule at ${CCA_TAG}`,
      run: () => {
        const dir = `${deps.root}contracts/lib/continuous-clearing-auction`
        const r = deps.exec("git", ["-C", dir, "describe", "--tags", "--exact-match"], deps.root)
        if (!r.ok || !r.stdout)
          return { status: "fail", detail: `CCA not at a tag. Run git submodule update --init --recursive` }
        return r.stdout === CCA_TAG
          ? { status: "ok", detail: `CCA ${r.stdout}` }
          : { status: "fail", detail: `CCA at ${r.stdout}, must be ${CCA_TAG}` }
      },
    },
    {
      id: "rpc-chain",
      owner: "S1",
      title: "RPC reachable, chain 84532",
      run: async ({ env }) => {
        if (!live(env)) return skipped(env)
        const url = rpcUrlFor(env)
        if (!url) return { status: "fail", detail: `No RPC for CHAIN_MODE=${env.CHAIN_MODE}` }
        try {
          const id = await deps.rpc(url).chainId()
          return id === BASE_SEPOLIA_CHAIN_ID
            ? { status: "ok", detail: `Chain ${id}` }
            : { status: "fail", detail: `Chain ${id}, need ${BASE_SEPOLIA_CHAIN_ID}` }
        } catch (e) {
          return rpcFailure(e)
        }
      },
    },
    {
      id: "wallet-balances",
      owner: "S1",
      title: "Deployer and keeper funded",
      run: async ({ env }) => {
        if (!live(env)) return skipped(env)
        const url = rpcUrlFor(env)
        if (!url) return { status: "fail", detail: `No RPC for CHAIN_MODE=${env.CHAIN_MODE}` }
        const wallets = [
          { name: "deployer", varName: "DEPLOYER_PRIVATE_KEY", min: MIN_DEPLOYER_WEI },
          { name: "keeper", varName: "KEEPER_PRIVATE_KEY", min: MIN_KEEPER_WEI },
          { name: "operator", varName: "OPERATOR_PRIVATE_KEY", min: MIN_OPERATOR_WEI },
        ]
        const rpc = deps.rpc(url)
        const parts: string[] = []
        let status: Result["status"] = "ok"
        for (const w of wallets) {
          const a = addressOf(env[w.varName])
          if ("error" in a) {
            parts.push(`${w.varName} ${a.error}`)
            status = "fail"
            continue
          }
          let bal: bigint
          try {
            bal = await rpc.balance(a.address)
          } catch (e) {
            return rpcFailure(e)
          }
          const shown = `${w.name} ${a.address} ${formatEther(bal)} ETH`
          if (bal === 0n) {
            parts.push(`${shown}, empty`)
            status = "fail"
          } else if (bal < w.min) {
            parts.push(`${shown}, below ${formatEther(w.min)}`)
            if (status === "ok") status = "warn"
          } else {
            parts.push(shown)
          }
        }
        return { status, detail: parts.join("; ") }
      },
    },
    {
      id: "cre-wallet",
      owner: "S1",
      title: "CRE broadcast key funded",
      run: async ({ env }) => {
        if (!live(env)) return skipped(env)
        if (!env.CRE_ETH_PRIVATE_KEY) {
          return {
            status: "warn",
            detail: "CRE_ETH_PRIVATE_KEY unset: only needed for cre workflow simulate --broadcast",
          }
        }
        const a = addressOf(env.CRE_ETH_PRIVATE_KEY)
        if ("error" in a) return { status: "fail", detail: `CRE_ETH_PRIVATE_KEY ${a.error}` }
        const url = rpcUrlFor(env)
        if (!url) return { status: "fail", detail: `No RPC for CHAIN_MODE=${env.CHAIN_MODE}` }
        let bal: bigint
        try {
          bal = await deps.rpc(url).balance(a.address)
        } catch (e) {
          return rpcFailure(e)
        }
        const shown = `cre ${a.address} ${formatEther(bal)} ETH`
        if (bal === 0n) return { status: "fail", detail: `${shown}, empty` }
        if (bal < MIN_CRE_WEI) return { status: "warn", detail: `${shown}, below ${formatEther(MIN_CRE_WEI)}` }
        return { status: "ok", detail: shown }
      },
    },
    {
      id: "deployment",
      owner: "S1",
      title: "Deployment file and code",
      run: async ({ env }) => {
        if (!live(env)) return skipped(env)
        const network = env.CHAIN_MODE as "anvil" | "base-sepolia"
        const raw = deps.readFile(`${deps.root}deployments/${network}.json`)
        if (raw === null)
          return { status: "warn", detail: `No deployments/${network}.json yet. Run pnpm deploy:${network}` }
        let dep: ReturnType<typeof parseDeployment>
        try {
          dep = parseDeployment(JSON.parse(raw))
        } catch {
          return { status: "fail", detail: `deployments/${network}.json does not match the contract 8 schema` }
        }
        if (dep.network !== network) return { status: "fail", detail: `File is for ${dep.network}, not ${network}` }
        if (dep.chainId !== BASE_SEPOLIA_CHAIN_ID)
          return { status: "fail", detail: `chainId ${dep.chainId}, need 84532` }
        // anvil mode reads the local fork, not the upstream FORK_RPC_URL.
        const url = network === "anvil" ? env.ANVIL_RPC_URL || ANVIL_RPC : rpcUrlFor(env)
        if (!url) return { status: "fail", detail: `No RPC for CHAIN_MODE=${network}` }
        const rpc = deps.rpc(url)
        const missing: string[] = []
        try {
          for (const [name, address] of Object.entries(dep.contracts)) {
            const code = await rpc.code(address as Address)
            if (!code || code === "0x") missing.push(name)
          }
        } catch (e) {
          return rpcFailure(e)
        }
        if (missing.length) return { status: "fail", detail: `No code at ${missing.join(", ")}` }
        return {
          status: "ok",
          detail: `${network} block ${dep.deployedAtBlock}, ${Object.keys(dep.contracts).length} contracts, commit ${dep.commit.slice(0, 7)}`,
        }
      },
    },
  ]
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
export const s1Checks: Check[] = makeS1Checks({
  root: repoRoot,
  exec: defaultExec,
  rpc: defaultRpc,
  readFile: defaultReadFile,
})
