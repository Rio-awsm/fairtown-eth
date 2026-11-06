# Bidder eval (S2 5.1)

Provider: mock (FakeAi). Decisions: 200. Overall: **PASS**.

| Metric | Value | Threshold | Result |
| --- | --- | --- | --- |
| Schema-valid on first try | 100.0% | >= 98.0% | pass |
| Fallback to rules | 0.0% | <= 10.0% | pass |
| p95 latency | 0 ms | <= 4000 ms | pass |
| p50 latency | 0 ms | | |

Fallbacks by cause: timeout 0, invalid_output 0, provider_error 0, mock_error 0, unusable 0.
Actions: bid 200.
Guardrails on bids: accepted 168, clamped 32, rejected 0.

## 20 reasons to read aloud

| Case | Agent | Lot | Action | Reason | Guardrail |
| --- | --- | --- | --- | --- | --- |
| case-001 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 8.45, below my 9.4 cap | accepted |
| case-011 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2, below my 2.2 cap | accepted |
| case-021 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.1, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-031 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 8.712499, below my 9.4 cap | accepted |
| case-041 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2.054599, below my 2.2 cap | accepted |
| case-051 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.117999, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-061 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 9.062499, below my 9.4 cap | accepted |
| case-071 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2.127399, below my 2.2 cap | accepted |
| case-081 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.141999, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-091 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 8.45, below my 9.4 cap | accepted |
| case-101 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2, below my 2.2 cap | accepted |
| case-111 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.1, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-121 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 8.712499, below my 9.4 cap | accepted |
| case-131 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2.054599, below my 2.2 cap | accepted |
| case-141 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.117999, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-151 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 9.062499, below my 9.4 cap | accepted |
| case-161 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2.127399, below my 2.2 cap | accepted |
| case-171 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.141999, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-181 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 8.45, below my 9.4 cap | accepted |
| case-191 | Atlas Labs | gpu_hour #4 | bid (llm) | Fair at 2, below my 2.2 cap | accepted |
