import { loadEnv } from "@fairtown/shared/env"
import { readFileSync } from "node:fs"
import { createPublicClient, http, labelhash, type Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { describe, expect, it } from "vitest"
import { userRegistryImplAbi } from "../../src/addons/ens/abi/userRegistryImpl"
import { EnsClient, txUrl, type EnsState } from "../../src/addons/ens/client"
import { ROLE } from "../../src/addons/ens/contracts"

// pnpm -F agents test:live (Sepolia, spends a little test ETH). Register, resolve through the Universal Resolver, revoke,
// and the role failure path: an account without ROLE_REGISTRAR cannot register.
const { env } = loadEnv(new URL("../../../../.env", import.meta.url).pathname)
const ready = !!env.ENS_PRIVATE_KEY && !!env.ENS_SEPOLIA_RPC_URL
const state: EnsState | undefined = ready ? JSON.parse(readFileSync(new URL("../../src/addons/ens/sepolia.json", import.meta.url), "utf8")) : undefined

describe.skipIf(!ready)("ENSv2 Sepolia (live)", () => {
  it("registers a subname, resolves it through ENS, revokes its role, and refuses an unauthorised registrar", { timeout: 300_000 }, async () => {
    const ens = new EnsClient(env.ENS_SEPOLIA_RPC_URL!, privateKeyToAccount(env.ENS_PRIVATE_KEY as `0x${string}`))
    const s = state!
    const label = `probe-${Date.now().toString(36)}`
    const name = `${label}.${s.parent}`
    const owner = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + 3600n

    const reg = await ens.registerSub(s, label, owner, expiry, ROLE.SET_RESOLVER)
    const rec = await ens.setRecords(s, name, { "fairtown.role": "PROBE", "fairtown.verified": "true" }, owner)
    console.log(`register ${txUrl(reg.hash)}\nrecords ${txUrl(rec.hash)}`)
    expect((await ens.ownerOf(s, label)).toLowerCase()).toBe(owner)
    expect((await ens.address(name))?.toLowerCase()).toBe(owner)
    expect(await ens.text(name, "fairtown.verified")).toBe("true")
    expect(await ens.hasRole(s, label, ROLE.SET_RESOLVER, owner)).toBe(true)

    const rev = await ens.revokeRole(s, label, ROLE.SET_RESOLVER, owner)
    console.log(`revoke ${txUrl(rev.hash)}`)
    expect(await ens.hasRole(s, label, ROLE.SET_RESOLVER, owner)).toBe(false)

    const stranger = privateKeyToAccount(generatePrivateKey())
    const pub = createPublicClient({ chain: sepolia, transport: http(env.ENS_SEPOLIA_RPC_URL) })
    const err = await pub
      .simulateContract({ account: stranger, address: s.registry, abi: userRegistryImplAbi, functionName: "register", args: [`${label}-x`, stranger.address, "0x0000000000000000000000000000000000000000", s.resolver, 0n, expiry] })
      .catch((e) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).toMatch(/EACUnauthorizedAccountRoles|reverted/)
    expect(BigInt(labelhash(label))).toBeGreaterThan(0n)
  })
})
