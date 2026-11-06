import type { AiRole } from "./config"

export type FakeInput = { system: string; prompt: string; images: number }
export type FakeHandler = (input: FakeInput) => unknown

// Deterministic stand-in used when MOCK_AI=1. Tests and later steps register a handler per role.
export class FakeAi {
  private readonly handlers = new Map<AiRole, FakeHandler>()
  transcript = "600 kg cod, landed 04:40, Bergen"

  on(role: AiRole, handler: FakeHandler) {
    this.handlers.set(role, handler)
    return this
  }
  respond(role: AiRole, input: FakeInput): unknown {
    const h = this.handlers.get(role)
    if (!h) throw new Error(`FakeAi has no handler for role ${role}`)
    return h(input)
  }
}
