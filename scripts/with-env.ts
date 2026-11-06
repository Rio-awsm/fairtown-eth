import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type { Env } from "./doctor/core"
import { loadEnv } from "@fairtown/shared/env"

export const REDACTED = "<redacted>"
/** Values that must never reach a terminal or log. */
export const SECRET_VARS = [
  "RPC_URL",
  "FORK_RPC_URL",
  "RPC_WS_URL",
  "ETHERSCAN_API_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "OPERATOR_PRIVATE_KEY",
  "KEEPER_PRIVATE_KEY",
  "CRE_ETH_PRIVATE_KEY",
  "AGENT_MNEMONIC",
] as const

export function secretsOf(env: Env): string[] {
  // Longest first, so a URL is replaced before any key it contains.
  return SECRET_VARS.map((k) => env[k])
    .filter((v): v is string => !!v && v.length >= 8)
    .sort((a, b) => b.length - a.length)
}

export function redactAll(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) out = out.split(s).join(REDACTED)
  return out
}

/** `with-env [--cwd <dir>] -- <cmd> [args...]`; dir is relative to the repo root. */
export function parseArgs(argv: string[]): { cwd: string | null; cmd: string; args: string[] } {
  let cwd: string | null = null
  let i = 0
  if (argv[0] === "--cwd") {
    cwd = argv[1] ?? null
    if (!cwd) throw new Error("--cwd needs a directory")
    i = 2
  }
  if (argv[i] === "--") i++
  const [cmd, ...args] = argv.slice(i)
  if (!cmd) throw new Error("Usage: with-env [--cwd <dir>] -- <cmd> [args...]")
  return { cwd, cmd, args }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const { env } = loadEnv(`${root}.env`)
  const { cwd, cmd, args } = parseArgs(process.argv.slice(2))
  const secrets = secretsOf(env)
  const child = spawn(cmd, args, {
    cwd: cwd ? new URL(cwd.endsWith("/") ? cwd : `${cwd}/`, `file://${root}`).pathname : root,
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    stdio: ["inherit", "pipe", "pipe"],
  })
  createInterface({ input: child.stdout }).on("line", (l) => process.stdout.write(`${redactAll(l, secrets)}\n`))
  createInterface({ input: child.stderr }).on("line", (l) => process.stderr.write(`${redactAll(l, secrets)}\n`))
  child.on("error", () => {
    console.error(`${cmd} not found`)
    process.exit(1)
  })
  child.on("exit", (code) => process.exit(code ?? 1))
}
