// Strip what must never reach a log: RPC URLs (they embed API keys), bearer tokens, and hex values labelled as keys or
// secrets. Transaction hashes stay readable.
export function redact(e: unknown): string {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : typeof e === "string" ? e : JSON.stringify(e)
  return (text ?? "")
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi, "<url>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>")
    .replace(/((?:private[_ ]?key|secret|mnemonic|password)\W{0,3})(?:0x)?[0-9a-fA-F]{40,}/gi, "$1<redacted>")
    .slice(0, 400)
}
