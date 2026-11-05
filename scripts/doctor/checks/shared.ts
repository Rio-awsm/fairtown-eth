import { atLeast, type Check, type Env } from "../core"

const MODES: Record<string, string[]> = {
  CHAIN_MODE: ["fake", "anvil", "base-sepolia"],
  ARKIV_MODE: ["live", "memory"],
  MOCK_AI: ["0", "1"],
}

const NEEDS: Array<{ when: (e: Env) => boolean; label: string; vars: string[] }> = [
  { when: (e) => e.CHAIN_MODE === "base-sepolia", label: "CHAIN_MODE=base-sepolia", vars: ["RPC_URL", "CHAIN_ID"] },
  { when: (e) => e.CHAIN_MODE === "anvil", label: "CHAIN_MODE=anvil", vars: ["FORK_RPC_URL"] },
  { when: (e) => e.ARKIV_MODE === "live", label: "ARKIV_MODE=live", vars: ["ARKIV_ACCESS_KEY", "ARKIV_PRIVATE_KEY"] },
  { when: (e) => e.MOCK_AI === "0", label: "MOCK_AI=0", vars: ["LLM_BASE_URL"] },
]

export const sharedChecks: Check[] = [
  {
    id: "node-version",
    owner: "shared",
    title: "Node 22.10+",
    run: ({ versions }) =>
      atLeast(versions.node, "22.10.0")
        ? { status: "ok", detail: `Node ${versions.node}` }
        : { status: "fail", detail: `Node ${versions.node}, need 22.10.0 or later` },
  },
  {
    id: "pnpm-version",
    owner: "shared",
    title: "pnpm 9.x",
    run: ({ versions }) => {
      if (!versions.pnpm) return { status: "fail", detail: "pnpm not found" }
      return versions.pnpm.startsWith("9.")
        ? { status: "ok", detail: `pnpm ${versions.pnpm}` }
        : { status: "fail", detail: `pnpm ${versions.pnpm}, repo pins 9.15.9 (packageManager)` }
    },
  },
  {
    id: "env-file",
    owner: "shared",
    title: ".env present",
    run: ({ envFileFound }) =>
      envFileFound
        ? { status: "ok", detail: ".env found" }
        : { status: "warn", detail: "No .env. Copy .env.example; mock modes still work from the shell" },
  },
  {
    id: "env-modes",
    owner: "shared",
    title: "Mode variables",
    run: ({ env }) => {
      const keys = Object.keys(MODES)
      const bad = keys.filter((k) => env[k] !== undefined && !MODES[k]!.includes(env[k]!))
      const unset = keys.filter((k) => env[k] === undefined)
      if (bad.length) return { status: "fail", detail: `Invalid value for ${bad.join(", ")}` }
      if (unset.length) return { status: "warn", detail: `Unset: ${unset.join(", ")}` }
      return { status: "ok", detail: keys.map((k) => `${k}=${env[k]}`).join(" ") }
    },
  },
  {
    id: "env-required",
    owner: "shared",
    title: "Vars for active modes",
    run: ({ env }) => {
      const missing = NEEDS.filter((n) => n.when(env))
        .map((n) => ({ label: n.label, vars: n.vars.filter((v) => !env[v]) }))
        .filter((n) => n.vars.length)
      if (missing.length) {
        return { status: "fail", detail: missing.map((m) => `${m.label} needs ${m.vars.join(", ")}`).join("; ") }
      }
      if (env.CHAIN_MODE === "base-sepolia" && env.CHAIN_ID !== "84532") {
        return { status: "fail", detail: "CHAIN_ID must be 84532 for base-sepolia" }
      }
      return { status: "ok", detail: "All set for the active modes" }
    },
  },
]
