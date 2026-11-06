import { loadDeployment } from "@fairtown/shared/addresses"
import { loadEnv } from "@fairtown/shared/env"
import type { TownEnvelope } from "@fairtown/shared"
import { TownSnapshot } from "@fairtown/shared/protocol"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { ChainWatcher } from "../../src/chainWatcher"
import { buildRelay } from "../../src/server"
import { RelayState } from "../../src/state"

// Opt-in: pnpm -F relay test:live. Backfills Base Sepolia from the v1 deployment block through the relay to a WebSocket client.
const { env } = loadEnv(new URL("../../../../.env", import.meta.url).pathname)

describe("relay on Base Sepolia", () => {
  it("streams real lots to a WebSocket client through sold, handover, delivered and paid in full", async () => {
    const deployment = await loadDeployment("base-sepolia")
    const state = new RelayState(5_000)
    const relay = buildRelay({ state, token: "t", logger: false })
    await relay.app.listen({ port: 0, host: "127.0.0.1" })
    const ws = new WebSocket(`ws://127.0.0.1:${(relay.app.server.address() as AddressInfo).port}/ws`)
    await once(ws, "open")
    const got: TownEnvelope[] = []
    ws.on("message", (d) => got.push(JSON.parse(String(d))))
    const errors: string[] = []
    const watcher = new ChainWatcher({
      deployment,
      rpcUrl: env.RPC_URL!,
      wsUrl: env.RPC_WS_URL!,
      fromBlock: BigInt(deployment.deployedAtBlock),
      publish: (envs) => relay.publish(envs),
      nameOf: (a) => state.nameOf(a),
      // Never print raw RPC errors: they carry the provider URL and key.
      onError: (w, e) => errors.push(`${w}: ${(e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+|wss?:\/\/\S+/g, "<rpc>").split("\n")[0]!.slice(0, 120)}`),
    })
    const started = Date.now()
    await watcher.start()
    await new Promise((r) => setTimeout(r, 6_000))
    watcher.stop()
    const types = new Set(got.map((e) => e.event.type))
    console.log(`backfill ${Date.now() - started} ms, ${got.length} envelopes over ws, types: ${[...types].join(", ")}`)
    console.log("errors:", errors.length ? errors.slice(0, 3) : "none")
    for (const t of ["lot.listed", "bid.placed", "lot.settled", "transport.needed", "handover.confirmed", "lot.delivered", "lot.paid_in_full", "clock"])
      expect(types, t).toContain(t)
    const snap = TownSnapshot.parse(state.snapshot())
    const statuses = Object.fromEntries(snap.lots.map((l) => [l.lotId, l.status]))
    console.log("lot statuses:", JSON.stringify(statuses))
    expect(Object.values(statuses)).toContain("paid_in_full")
    expect(Object.values(statuses)).toContain("sold")
    ws.close()
    await relay.app.close()
  }, 180_000)
})
