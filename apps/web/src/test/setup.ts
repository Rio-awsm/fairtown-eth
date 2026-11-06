import "@testing-library/jest-dom/vitest"
import { afterEach } from "vitest"

// Vitest runs without globals, so Testing Library's auto-cleanup never registers.
afterEach(async () => {
  if (typeof document === "undefined") return
  const { cleanup } = await import("@testing-library/react")
  cleanup()
})
