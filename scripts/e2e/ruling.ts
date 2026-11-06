/**
 * A MOCKED CRE W3 ruling for the combine e2e (C 1.3, C 2.1). W3 (S1 4.4) is not built, so on the anvil fork the test
 * impersonates the DisputeResolver's forwarder and delivers the report W3 would: abi.encode(disputeId, refundBps,
 * reasonHash). Every caller labels the result as mocked.
 */
import { disputeResolverAbi } from "@fairtown/shared/abi"
import {
  concat,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  toHex,
  zeroAddress,
  type Address,
  type PublicClient,
  type TransactionReceipt,
} from "viem"
import { baseSepolia } from "viem/chains"
import { ANVIL_URL } from "./stack"

export async function mockRuling(pub: PublicClient, resolver: Address, disputeId: bigint, refundBps: number, reason: string): Promise<TransactionReceipt> {
  const test = createTestClient({ chain: baseSepolia, mode: "anvil", transport: http(ANVIL_URL) })
  const forwarder = await pub.readContract({ address: resolver, abi: disputeResolverAbi, functionName: "forwarder" })
  const owner = await pub.readContract({ address: resolver, abi: disputeResolverAbi, functionName: "expectedWorkflowOwner" })
  const metadata = owner === zeroAddress ? "0x" : concat([pad("0x", { size: 42 }), owner]) // workflow owner at bytes 42..62
  const report = encodeAbiParameters([{ type: "uint256" }, { type: "uint16" }, { type: "bytes32" }], [disputeId, refundBps, keccak256(toHex(`e2e mocked ruling: ${reason}`))])
  await test.impersonateAccount({ address: forwarder })
  await test.setBalance({ address: forwarder, value: 10n ** 18n })
  const hash = await createWalletClient({ account: forwarder, chain: baseSepolia, transport: http(ANVIL_URL) }).writeContract({
    address: resolver,
    abi: disputeResolverAbi,
    functionName: "onReport",
    args: [metadata, report],
  })
  await test.stopImpersonatingAccount({ address: forwarder })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== "success") throw new Error(`mocked ruling for dispute ${disputeId} reverted`)
  return r
}
