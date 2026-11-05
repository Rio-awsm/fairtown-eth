import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type { Env } from "./doctor/core"
import { loadEnv } from "./doctor/env"

export const FORK_PORT = 8545
export const FORK_CHAIN_ID = 84532
export const REDACTED = "<FORK_RPC_URL>"

/** anvil args for a Base Sepolia fork. Throws (without echoing values) when the fork URL is missing. */
export function anvilArgs(env: Env): { url: string; args: string[] } {
  const url = env.FORK_RPC_URL || env.RPC_URL
  if (!url) throw new Error("FORK_RPC_URL (or RPC_URL) is unset. Fill it in .env")
  if (!/^https?:\/\//.test(url)) throw new Error("FORK_RPC_URL must be an http(s) URL")
  return {
    url,
    args: ["--fork-url", url, "--chain-id", String(FORK_CHAIN_ID), "--port", String(FORK_PORT)],
  }
}

/** Anvil prints the fork endpoint in its banner; the URL can carry an RPC API key. */
export function redact(text: string, url: string): string {
  return url ? text.split(url).join(REDACTED) : text
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const { env } = loadEnv(`${root}.env`)
  let fork: ReturnType<typeof anvilArgs>
  try {
    fork = anvilArgs(env)
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
  const child = spawn("anvil", fork.args, { stdio: ["inherit", "pipe", "pipe"] })
  // Line-buffered so a URL split across two chunks is still redacted.
  createInterface({ input: child.stdout }).on("line", (l) => process.stdout.write(`${redact(l, fork.url)}\n`))
  createInterface({ input: child.stderr }).on("line", (l) => process.stderr.write(`${redact(l, fork.url)}\n`))
  child.on("error", () => {
    console.error("anvil not found. Install Foundry (contracts/README.md)")
    process.exit(1)
  })
  child.on("exit", (code) => process.exit(code ?? 1))
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig))
}
