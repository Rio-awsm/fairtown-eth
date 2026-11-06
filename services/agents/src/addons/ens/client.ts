import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, labelhash, parseEventLogs, toHex, type Address, type Hex, type LocalAccount } from "viem"
import { sepolia } from "viem/chains"
import { normalize } from "viem/ens"
import { ethRegistrarAbi } from "./abi/ethRegistrar"
import { factoryAbi } from "./abi/factory"
import { mockUSDCAbi } from "./abi/mockUSDC"
import { resolverImplAbi } from "./abi/resolverImpl"
import { userRegistryImplAbi } from "./abi/userRegistryImpl"
import { addrBytes, ALL_ROLES, coinTypeEth, dnsName, ENS_SEPOLIA as C, registrySalt, resolverSalt } from "./contracts"

export type EnsState = { parent: string; resolver: Address; registry: Address; owner: Address; txs: Record<string, Hex> }
export type Records = Record<string, string>

const strip = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "<rpc>").split("\n")[0]!.slice(0, 200)
export const txUrl = (h: Hex) => `https://sepolia.etherscan.io/tx/${h}`

// ENSv2 on Sepolia from one service wallet (it owns fairtown.eth, the registry and the resolver). Every write is simulated
// first and sent through one queue so nonces never race.
export class EnsClient {
  readonly pub
  private readonly wallet
  private q: Promise<unknown> = Promise.resolve()

  constructor(
    rpcUrl: string,
    readonly account: LocalAccount,
  ) {
    this.pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { retryCount: 3, timeout: 30_000 }) })
    this.wallet = createWalletClient({ chain: sepolia, transport: http(rpcUrl, { retryCount: 1, timeout: 30_000 }), account })
  }

  private send(req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }, label: string): Promise<{ hash: Hex; logs: unknown[] }> {
    const run = async () => {
      try {
        const sim = (await this.pub.simulateContract({ ...(req as object), account: this.account } as never)) as unknown as { request: never }
        const hash = await this.wallet.writeContract(sim.request)
        const r = await this.pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
        if (r.status !== "success") throw new Error(`${label} reverted (${hash})`)
        return { hash, logs: r.logs }
      } catch (e) {
        throw new Error(`${label}: ${strip(e)}`)
      }
    }
    const p = this.q.then(run, run)
    this.q = p.catch(() => undefined)
    return p
  }

  private async hasCode(a: Address) {
    const code = await this.pub.getCode({ address: a })
    return !!code && code !== "0x"
  }

  // Deterministic proxy through VerifiableFactory; reused if it already exists.
  async proxy(impl: Address, salt: bigint, init: Hex, label: string): Promise<{ address: Address; tx?: Hex }> {
    const predicted = await this.pub.readContract({ address: C.VerifiableFactory, abi: factoryAbi, functionName: "predictProxyAddress", args: [this.account.address, salt] })
    if (await this.hasCode(predicted)) return { address: predicted }
    const r = await this.send({ address: C.VerifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [impl, salt, init] }, label)
    const [log] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: r.logs as never })
    return { address: ((log as { args?: { proxyAddress?: Address } })?.args?.proxyAddress ?? predicted) as Address, tx: r.hash }
  }

  deployResolver() {
    const init = encodeFunctionData({ abi: resolverImplAbi, functionName: "initialize", args: [[{ account: this.account.address, roleBitmap: ALL_ROLES }], []] })
    return this.proxy(C.PermissionedResolverImpl, resolverSalt(this.account.address), init, "deploy resolver")
  }
  deployRegistry(parent: string) {
    const init = encodeFunctionData({ abi: userRegistryImplAbi, functionName: "initialize", args: [[{ account: this.account.address, roleBitmap: ALL_ROLES }]] })
    return this.proxy(C.UserRegistryImpl, registrySalt(this.account.address, parent), init, "deploy registry")
  }

  isAvailable(label: string) {
    return this.pub.readContract({ address: C.ETHRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] })
  }

  // .eth registration: mint test MockUSDC, approve, commit, wait MIN_COMMITMENT_AGE, register pointing at our registry and resolver.
  async registerParent(label: string, registry: Address, resolver: Address, onWait?: (s: number) => void): Promise<Record<string, Hex>> {
    const txs: Record<string, Hex> = {}
    const duration = 365n * 86_400n
    const [base, premium] = await this.pub.readContract({ address: C.ETHRegistrar, abi: ethRegistrarAbi, functionName: "getRegisterPrice", args: [label, duration, C.MockUSDC] })
    const price = base + premium
    const bal = await this.pub.readContract({ address: C.MockUSDC, abi: mockUSDCAbi, functionName: "balanceOf", args: [this.account.address] })
    if (bal < price) txs.mint = (await this.send({ address: C.MockUSDC, abi: mockUSDCAbi, functionName: "mint", args: [this.account.address, price * 2n] }, "mint MockUSDC")).hash
    txs.approve = (await this.send({ address: C.MockUSDC, abi: mockUSDCAbi, functionName: "approve", args: [C.ETHRegistrar, price] }, "approve registrar")).hash
    const secret = keccak256(toHex(`${label}:${Date.now()}:${Math.random()}`))
    const referrer = `0x${"0".repeat(64)}` as Hex
    const commitment = await this.pub.readContract({ address: C.ETHRegistrar, abi: ethRegistrarAbi, functionName: "makeCommitment", args: [label, this.account.address, secret, registry, resolver, duration, referrer] })
    txs.commit = (await this.send({ address: C.ETHRegistrar, abi: ethRegistrarAbi, functionName: "commit", args: [commitment] }, "commit")).hash
    const age = Number(await this.pub.readContract({ address: C.ETHRegistrar, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" }))
    onWait?.(age + 15)
    await new Promise((r) => setTimeout(r, (age + 15) * 1000))
    txs.register = (await this.send({ address: C.ETHRegistrar, abi: ethRegistrarAbi, functionName: "register", args: [label, this.account.address, secret, registry, resolver, duration, C.MockUSDC, referrer] }, "register parent")).hash
    return txs
  }

  // A subname in our registry, owned by the agent's wallet, records on our resolver. The owner gets only SET_RESOLVER (our
  // "verified" role), so the service can revoke it on a no-show; the service keeps root roles (managed registry).
  async registerSub(s: EnsState, label: string, owner: Address, expiry: bigint, ownerRoles: bigint) {
    return this.send({ address: s.registry, abi: userRegistryImplAbi, functionName: "register", args: [label, owner, "0x0000000000000000000000000000000000000000", s.resolver, ownerRoles, expiry] }, `register ${label}`)
  }

  setRecords(s: EnsState, name: string, records: Records, addr?: Address) {
    const n = dnsName(name)
    const calls: Hex[] = Object.entries(records).map(([k, v]) => encodeFunctionData({ abi: resolverImplAbi, functionName: "setText", args: [n, k, v] }))
    if (addr) calls.push(encodeFunctionData({ abi: resolverImplAbi, functionName: "setAddress", args: [n, coinTypeEth, addrBytes(addr)] }))
    return this.send({ address: s.resolver, abi: resolverImplAbi, functionName: "multicall", args: [calls] }, `records ${name}`)
  }

  revokeRole(s: EnsState, label: string, role: bigint, account: Address) {
    return this.send({ address: s.registry, abi: userRegistryImplAbi, functionName: "revokeRoles", args: [BigInt(labelhash(label)), role, account] }, `revoke ${label}`)
  }

  hasRole(s: EnsState, label: string, role: bigint, account: Address) {
    return this.pub.readContract({ address: s.registry, abi: userRegistryImplAbi, functionName: "hasRoles", args: [BigInt(labelhash(label)), role, account] })
  }
  ownerOf(s: EnsState, label: string) {
    return this.pub.readContract({ address: s.registry, abi: userRegistryImplAbi, functionName: "getOwner", args: [BigInt(labelhash(label))] })
  }

  // Reads through the real ENS path (Universal Resolver walks root -> .eth -> our registry -> our resolver).
  text(name: string, key: string) {
    return this.pub.getEnsText({ name: normalize(name), key, universalResolverAddress: C.UniversalResolverV2 })
  }
  address(name: string) {
    return this.pub.getEnsAddress({ name: normalize(name), universalResolverAddress: C.UniversalResolverV2 })
  }
}
