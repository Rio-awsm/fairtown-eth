import { verifyTypedData, type Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import { decodeTicket, encodeTicket, HANDOVER_TYPES, handoverDomain, type HandoverTicket } from "../src/handover"

const settlement: Address = "0x00000000000000000000000000000000000000c3"
const buyer: Address = "0x00000000000000000000000000000000000000a1"
const seller = privateKeyToAccount(generatePrivateKey())
const message = { lotId: 12n, buyer, tokenAmount: 600n * 10n ** 18n, expiryBlock: 1400n }
const domain = handoverDomain(84532, settlement)
const types = HANDOVER_TYPES
const sig65 = "0x" + "11".repeat(65)

async function signed(): Promise<HandoverTicket> {
  const sig = await seller.signTypedData({ domain, types, primaryType: "Handover", message })
  return { ...message, sig }
}

describe("EIP-712 handover", () => {
  it("uses domain Fairtown / 1", () => {
    expect(domain).toEqual({ name: "Fairtown", version: "1", chainId: 84532, verifyingContract: settlement })
  })
  it("verifies for the seller", async () => {
    const t = await signed()
    const ok = await verifyTypedData({
      address: seller.address,
      domain,
      types,
      primaryType: "Handover",
      message,
      signature: t.sig,
    })
    expect(ok).toBe(true)
  })
  it("fails when the amount is changed", async () => {
    const t = await signed()
    const tampered = { ...message, tokenAmount: message.tokenAmount + 1n }
    const ok = await verifyTypedData({
      address: seller.address,
      domain,
      types,
      primaryType: "Handover",
      message: tampered,
      signature: t.sig,
    })
    expect(ok).toBe(false)
  })
  it("fails on another chain", async () => {
    const t = await signed()
    const ok = await verifyTypedData({
      address: seller.address,
      domain: handoverDomain(1, settlement),
      types,
      primaryType: "Handover",
      message,
      signature: t.sig,
    })
    expect(ok).toBe(false)
  })
})

describe("QR text", () => {
  it("round-trips", async () => {
    const t = await signed()
    expect(decodeTicket(encodeTicket(t))).toEqual(t)
  })
  const json = (o: object) =>
    JSON.stringify({ lotId: "12", buyer, tokenAmount: "1", expiryBlock: "1400", sig: sig65, ...o })
  it.each([
    ["not JSON", "hello"],
    ["a URL from another QR", "https://example.com"],
    ["a JSON array", "[1,2]"],
    ["missing sig", JSON.stringify({ lotId: "12", buyer, tokenAmount: "1", expiryBlock: "1400" })],
    ["negative lotId", json({ lotId: "-1" })],
    ["bad buyer", json({ buyer: "0x123" })],
    ["extra field", json({ to: "x" })],
    ["expiryBlock over uint64", json({ expiryBlock: (2n ** 64n).toString() })],
    ["short sig", json({ sig: "0x1234" })],
  ])("rejects %s", (_, text) => {
    expect(() => decodeTicket(text)).toThrow("This isn't a Fairtown handover code")
  })
})
