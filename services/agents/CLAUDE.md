# Stream 2 rules
- TypeScript, Node 22, ESM. Fastify, ws, viem, Vitest, pino.
- Every AI call goes through src/ai/gateway.ts. AI config only from env. MOCK_AI=1 makes tests deterministic.
- Chain only through ChainAdapter. Arkiv only through ArkivStore.
- Guardrails are code. LLM output is zod-validated; on failure use the rule strategy.
- Money is bigint base units. Shapes from @fairtown/shared.
- Seller keys sign handover tickets only inside src/handover. Never log signatures with private data.
- Log Arkiv friction to arkiv/friction.md as it happens.
