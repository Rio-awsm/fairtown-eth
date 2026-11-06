// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// A local anvil fork: no public explorer has these transactions.
vi.mock("../config", () => ({ env: { explorerUrl: undefined } }))
const { AddressLink, explorerTx, TxLink } = await import("./links")

const TX = `0x${"ab".repeat(32)}`

describe("explorer links on a local fork", () => {
  it("builds no explorer URL", () => {
    expect(explorerTx(TX)).toBeUndefined()
  })

  it("shows a tx as labelled text, not a dead link", () => {
    render(<TxLink tx={TX} />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText(/\(local\)/)).toHaveAttribute("title", expect.stringContaining("Local fork"))
  })

  it("shows an address as text", () => {
    render(<AddressLink address={`0x${"cd".repeat(20)}`} />)
    expect(screen.queryByRole("link")).toBeNull()
  })
})
