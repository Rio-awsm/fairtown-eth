import { loadEnv } from "@fairtown/shared/env"
import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import { describe, expect, it } from "vitest"
import { LiveArkivStore } from "../../src/arkiv/LiveArkivStore"
import { arkivSuite } from "../arkiv.suite"

// Opt-in: pnpm -F agents test:live. Writes small test entities to Arkiv Rabdi with the writer key (1 h expiry).
const { env } = loadEnv(new URL("../../../../.env", import.meta.url).pathname)
const pk = env.ARKIV_PRIVATE_KEY!.trim()
const writer = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex)
const friction: string[] = []
const store = new LiveArkivStore({ accessKey: env.ARKIV_ACCESS_KEY!, writer, onFriction: (n) => friction.push(n) })
const run = `${Date.now()}`

describe("ArkivStore suite: live Rabdi", () => {
  it("is on Rabdi with a funded writer", async () => {
    const c = await store.checkChain()
    console.log("writer", c.writer, "balance wei", c.balance.toString())
    expect(c.chainId).toBe(7794095)
    expect(c.balance > 0n).toBe(true)
  })
  arkivSuite(() => store, writer.address.toLowerCase() as Hex, run, BigInt(run) * 1000n)
  it("logged friction", () => {
    console.log("friction:", friction.length ? friction : "none")
  })
}, 300_000)
