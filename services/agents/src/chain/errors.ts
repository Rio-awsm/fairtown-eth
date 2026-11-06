export type ChainErrorCode =
  | "CannotList"
  | "CannotBid"
  | "NotSeller"
  | "FloorTooLow"
  | "BadSpec"
  | "LotNotFound"
  | "AuctionEnded"
  | "AuctionOpen"
  | "BelowClearing"
  | "BadAmount"
  | "NoPermit2"
  | "InsufficientBalance"
  | "InsufficientTokens"
  | "BadSignature"
  | "NotBuyerOrCarrier"
  | "TicketExpired"
  | "TicketUsed"
  | "NoSigner"
  | "TooEarly"
  | "WindowClosed"
  | "NotHeld"
  | "AlreadyReported"
  | "NoReport"
  | "AlreadyContested"
  | "DisputeNotFound"
  | "NothingToRelist"
  | "FloorNotLower"
  | "NotImplemented"

export class ChainError extends Error {
  constructor(
    readonly code: ChainErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = "ChainError"
  }
}
