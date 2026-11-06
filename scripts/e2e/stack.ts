/**
 * The local Fairtown stack for the combine e2e scripts and `pnpm dev:all` (C 1.1, C 1.2): an anvil fork of Base Sepolia
 * (or Base Sepolia itself), keeper, agents, and optionally relay and web. Service logs go to .data/e2e/<run>/, with
 * secrets redacted. Never prints keys, the mnemonic or RPC URLs. TEST MONEY.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import { createConnection } from "node:net"
import { fileURLToPath } from "node:url"
import { loadEnv } from "@fairtown/shared/env"
import { createPublicClient, createTestClient, http, type AbiEvent, type Address, type Hash, type Log, type PublicClient } from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"
import { anvilArgs, FORK_PORT } from "../chain-fork"

export type Network = "anvil" | "base-sepolia"
export const root = fileURLToPath(new URL("../../", import.meta.url))
export const { env } = loadEnv(`${root}.env`)
export const ANVIL_URL = `http://127.0.0.1:${FORK_PORT}`
export const AGENTS_PORT = Number(env.AGENTS_PORT ?? 8787)
export const RELAY_PORT = Number(env.RELAY_PORT ?? 8788)
export const WEB_PORT = Number(env.WEB_PORT ?? 8080)
export const API = `http://127.0.0.1:${AGENTS_PORT}`
/** 27 personas (wallet index = persona order) plus room for walk-in buyers. */
const AGENT_WALLETS = 40

export function parseNetwork(argv: string[], usage: string): Network {
  const i = argv.indexOf("--network")
  const n = i >= 0 ? argv[i + 1] : "anvil"
  if (n !== "anvil" && n !== "base-sepolia") throw new Error(`Usage: ${usage} [--network anvil|base-sepolia]`)
  return n
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const portBusy = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" })
    s.once("connect", () => (s.destroy(), resolve(true)))
    s.once("error", () => resolve(false))
  })

/** One run: timestamps, redacted service logs, child processes and teardown. */
export class Run {
  readonly runDir: string
  readonly started = Date.now()
  private readonly children: ChildProcess[] = []
  private stopping = false
  private readonly secrets = [env.RPC_URL, env.RPC_WS_URL, env.LOGS_RPC_URL, env.FORK_RPC_URL, env.ARKIV_ACCESS_KEY]

  constructor(
    readonly name: string,
    readonly network: Network,
  ) {
    this.runDir = `${root}.data/e2e/${name}-${network}-${new Date().toISOString().replace(/[:.]/g, "-")}`
    mkdirSync(this.runDir, { recursive: true })
    process.on("unhandledRejection", (e) => this.fail(e))
    process.on("uncaughtException", (e) => this.fail(e))
    process.on("SIGINT", () => this.fail("interrupted"))
  }

  redact = (s: string) => this.secrets.reduce<string>((out, x) => (x ? out.split(x).join("<redacted>") : out), s)
  say = (msg: string) => console.log(`  ${((Date.now() - this.started) / 1000).toFixed(0).padStart(4)}s  ${msg}`)
  ok = (lines: string[]) => lines.forEach((l) => this.say(`ok  ${l}`))

  stop() {
    this.stopping = true
    for (const c of this.children) if (c.exitCode === null) c.kill("SIGTERM")
  }

  fail(e: unknown): never {
    console.error(`\n${this.name.toUpperCase()} FAILED: ${this.redact(e instanceof Error ? e.message : String(e))}`)
    console.error(`Service logs: ${this.runDir}`)
    this.stop()
    process.exit(1)
  }

  /** Polls `fn` until it returns a value; errors are retried and the last one is reported on timeout. */
  async until<T>(label: string, ms: number, fn: () => Promise<T | undefined>, everyMs = 2_000): Promise<T> {
    const end = Date.now() + ms
    let last = ""
    for (;;) {
      try {
        const v = await fn()
        if (v !== undefined) return v
      } catch (e) {
        last = e instanceof Error ? e.message : String(e)
      }
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}${last ? ` (last error: ${last})` : ""}`)
      await sleep(everyMs)
    }
  }

  start(name: string, cmd: string, args: string[], extraEnv: Record<string, string>) {
    const log = createWriteStream(`${this.runDir}/${name}.log`)
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const write = (b: Buffer) => log.write(this.redact(b.toString()))
    child.stdout!.on("data", write)
    child.stderr!.on("data", write)
    child.on("exit", (code) => {
      if (code !== null && code !== 0 && !this.stopping) this.fail(`${name} exited with code ${code}; see ${name}.log`)
    })
    this.children.push(child)
    return child
  }

  async api<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = (await res.json()) as T & { error?: { code: string; message: string } }
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`)
    return json
  }

  /** getLogs over [from, to] in chunks (sepolia.base.org: "eth_getLogs is limited to a 200 range"). */
  async logsIn(client: PublicClient, address: Address, event: AbiEvent, from: bigint, to: bigint, args?: object) {
    const chunk = this.network === "anvil" ? 1_000_000n : 200n
    const out: Log[] = []
    for (let a = from; a <= to; a += chunk) {
      const b = a + chunk - 1n < to ? a + chunk - 1n : to
      out.push(...(await client.getLogs({ address, event, fromBlock: a, toBlock: b, ...(args ? { args } : {}) } as never)))
    }
    return out
  }
}

export type Stack = { pub: PublicClient; logsClient: PublicClient }

/**
 * Starts the chain (anvil fork: automine while agents bootstrap, then 1 block/s), keeper and agents, plus relay and
 * web when asked. Anvil runs keep Arkiv in memory and use rule bidders (D-114).
 */
export async function startStack(run: Run, opts: { relay?: boolean; web?: boolean } = {}): Promise<Stack> {
  const network = run.network
  const ports = [
    ...(network === "anvil" ? [FORK_PORT] : []),
    AGENTS_PORT,
    ...(opts.relay ? [RELAY_PORT] : []),
    ...(opts.web ? [WEB_PORT] : []),
  ]
  for (const p of ports) if (await portBusy(p)) throw new Error(`port ${p} is in use; stop the running service first`)

  const rpcUrl = network === "anvil" ? ANVIL_URL : env.RPC_URL
  if (!rpcUrl) throw new Error("RPC_URL is unset")
  const pub = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 30_000 }) }) as PublicClient
  const logsClient = (
    network === "base-sepolia" && env.LOGS_RPC_URL
      ? createPublicClient({ chain: baseSepolia, transport: http(env.LOGS_RPC_URL, { timeout: 30_000 }) })
      : pub
  ) as PublicClient

  const services: Record<string, string> =
    network === "anvil"
      ? {
          CHAIN_MODE: "anvil",
          RPC_URL: ANVIL_URL,
          RPC_WS_URL: `ws://127.0.0.1:${FORK_PORT}`,
          LOGS_RPC_URL: ANVIL_URL,
          ANVIL_RPC_URL: ANVIL_URL,
          ARKIV_MODE: "memory",
          MOCK_AI: "1",
          CHAIN_BACKFILL_BLOCKS: "1",
        }
      : { CHAIN_MODE: "base-sepolia", ARKIV_MODE: "live" }

  if (network === "anvil") {
    run.start("anvil", "anvil", [...anvilArgs(env).args, "--silent"], {})
    await run.until("anvil", 60_000, async () => ((await pub.getChainId()) === baseSepolia.id ? true : undefined), 500)
    const test = createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(ANVIL_URL) })
    for (const k of ["OPERATOR_PRIVATE_KEY", "KEEPER_PRIVATE_KEY"]) {
      const key = env[k]
      if (!key) throw new Error(`${k} is unset`)
      await test.setBalance({ address: privateKeyToAccount(key as Hash).address, value: 10n ** 19n })
    }
    // Anvil quotes a 1 gwei priority fee (~200x Base Sepolia) and the agents cap fees at 2x, so bootstrap's 0.0005 ETH
    // per agent cannot pay for createLot (~5M gas) on the fork. Gas is set locally, as in the S1 smoke; real balances untouched.
    if (!env.AGENT_MNEMONIC) throw new Error("AGENT_MNEMONIC is unset")
    for (let i = 0; i < AGENT_WALLETS; i++) {
      await test.setBalance({ address: mnemonicToAccount(env.AGENT_MNEMONIC, { addressIndex: i }).address, value: 10n ** 18n })
    }
    run.say(`ok  anvil fork at block ${await pub.getBlockNumber()}, operator, keeper and ${AGENT_WALLETS} agent wallets funded locally`)
  }

  // The relay first, so it hears the agents' spawn announcements; agents bootstrap before their API listens.
  if (opts.relay) {
    run.start("relay", "pnpm", ["-s", "-F", "relay", "exec", "tsx", "src/index.ts"], services)
    await run.until("relay", 60_000, async () => ((await portBusy(RELAY_PORT)) ? true : undefined), 1_000)
  }
  run.start("keeper", "pnpm", ["-s", "-F", "keeper", "exec", "tsx", "src/index.ts", network], services)
  run.start("agents", "pnpm", ["-s", "-F", "agents", "exec", "tsx", "src/index.ts"], services)
  const health = await run.until(
    "agents /api/health",
    network === "anvil" ? 5 * 60_000 : 10 * 60_000,
    async () => run.api<{ chain: { ok: boolean; detail: string } }>("/api/health"),
    3_000,
  )
  run.say(`ok  agents up: ${health.chain.detail}`)
  if (opts.relay) run.say(`ok  relay up on :${RELAY_PORT}`)
  if (opts.web) {
    // Fork transactions exist only on this laptop: no explorer links (they would 404 on Basescan).
    const webEnv: Record<string, string> = network === "anvil" ? { VITE_EXPLORER_URL: "local" } : {}
    run.start("web", "pnpm", ["-s", "-F", "web", "exec", "vite", "--port", String(WEB_PORT), "--strictPort"], webEnv)
    await run.until("web", 60_000, async () => ((await fetch(`http://localhost:${WEB_PORT}/`)).ok ? true : undefined), 1_000)
    run.say(`ok  web up on http://localhost:${WEB_PORT}`)
  }
  if (network === "anvil") {
    await createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(ANVIL_URL) }).setIntervalMining({ interval: 1 })
    run.say("ok  anvil now mines 1 block per second")
  }
  return { pub, logsClient }
}
