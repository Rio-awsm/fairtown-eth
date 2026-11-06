/**
 * The mock handover ticket, with no imports, so the MSW handler and the Playwright config (which
 * turns this exact QR into a fake camera video) build the same text.
 */
export const MOCK_SIG = `0x${"cd".repeat(65)}`
/** Far ahead of the replay's blocks (about 1,000 to 1,200), so mock codes stay valid. */
export const MOCK_EXPIRY_BLOCK = "5000"

export type MockTicket = { lotId: string; buyer: string; tokenAmount: string; expiryBlock: string; sig: string }

export const mockTicket = (lotId: string, buyer: string, tokenAmount: string): MockTicket => ({
  lotId,
  buyer,
  tokenAmount,
  expiryBlock: MOCK_EXPIRY_BLOCK,
  sig: MOCK_SIG,
})
export const mockQrText = (t: MockTicket) => JSON.stringify(t)
export const mockFallbackUrl = (qrText: string) => `/scan?code=${encodeURIComponent(qrText)}`

/** Hanse Kitchen in the replay fixture, the winner of Lot 12 and of the truck lot 20. */
export const MOCK_HANSE = "0x0000000000000000000000000000000000000102"
export const MOCK_LOT12_UNITS = (600n * 10n ** 18n).toString()
