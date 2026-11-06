import { concat, encodeAbiParameters, keccak256, stringToHex, toHex, type Address, type Hex } from "viem"
import { packetToBytes } from "viem/ens"

// ENSv2 on Sepolia (docs.ens.domains/learn/deployments, ABIs from Sourcify-verified source, checked 2026-11-06).
export const ENS_SEPOLIA = {
  ETHRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  ETHRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  VerifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  UserRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
  PermissionedResolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  UniversalResolverV2: "0x24e1d8e068620b647ca097f961a61055f4f42d72",
  MockUSDC: "0x240b0316df57887dbbe58b586508b19e633a14aa",
} as const satisfies Record<string, Address>

// Every role occupies one nybble (4 bits, a holder count); admin roles sit 128 bits higher. One bit per nybble = all roles.
export const ALL_ROLES = BigInt(`0x${"1".repeat(64)}`)
export const ROLE = {
  REGISTRAR: 1n << 0n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
} as const
export const admin = (r: bigint) => r << 128n

// Salts: the docs' scheme for the per-account resolver; our own label for the registry.
export const resolverSalt = (owner: Address, version = 0n) =>
  BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(stringToHex("OwnedResolver")), owner, version])))
export const registrySalt = (owner: Address, parent: string, version = 0n) =>
  BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(stringToHex(`FairtownUserRegistry:${parent}`)), owner, version])))

// The PermissionedResolver addresses records by DNS-encoded name (source), not by namehash (as one docs tutorial shows).
export const dnsName = (name: string): Hex => toHex(packetToBytes(name))

// ENS labels: lowercase letters, digits and hyphens here (underscore is only valid as a leading character in ENSIP-15).
export function labelFor(id: string): string {
  const l = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
  if (!l) throw new Error(`No ENS label for "${id}"`)
  return l
}

export const coinTypeEth = 60n
export const addrBytes = (a: Address): Hex => concat([a])
