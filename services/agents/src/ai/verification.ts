import type { AiTrace } from "./providers"

export type VerificationState = "verified" | "failed" | "logged" | "fallback" | "none"
export type Verification = { state: VerificationState; label: string; trusted: boolean }

// The grade badge (guide 8.1): "Verified model" only when the 0G Router says tee_verified is true. Never faked.
export function verificationOf(t?: AiTrace): Verification {
  if (!t) return { state: "none", label: "Model not logged", trusted: true }
  if (t.fallback) return { state: "fallback", label: "Graded by the fallback model, not on 0G: not attested", trusted: true }
  if (t.teeVerified === true) return { state: "verified", label: "Verified model", trusted: true }
  if (t.teeVerified === false) return { state: "failed", label: "TEE check failed: grade untrusted", trusted: false }
  if (t.requestId)
    return { state: "logged", label: t.trustMode === "private" ? "Model logged, TEE-only provider, signature not attested" : "Model logged, not attested", trusted: true }
  return { state: "none", label: "Model not logged", trusted: true }
}
