# Bidder eval (S2 5.1)

Provider: mock (FakeAi). Decisions: 200. Overall: **PASS**.

| Metric | Value | Threshold | Result |
| --- | --- | --- | --- |
| Schema-valid on first try | 100.0% | >= 98.0% | pass |
| Fallback to rules | 0.0% | <= 10.0% | pass |
| p95 latency | 0 ms | <= 4000 ms | pass |
| p50 latency | 0 ms | | |

Fallbacks by cause: timeout 0, invalid_output 0, provider_error 0, rate_limited 0, mock_error 0, unusable 0.
Actions: bid 200.
Guardrails on bids: accepted 168, clamped 32, rejected 0.

## 20 reasons to read aloud

| Case | Agent | Lot | Action | Reason | Guardrail |
| --- | --- | --- | --- | --- | --- |
| case-001 | Hanse Kitchen Group | cod #1 | bid (llm) | Fair at 8.45, below my 9.4 cap | accepted |
| case-038 | Oslo Fiskehall | haddock #13 | bid (llm) | Fair at 7.281999, below my 8 cap | accepted |
| case-075 | Vector Mind | gpu_hour #4 | bid (llm) | Fair at 1.957399, below my 2 cap | clamped: amount clamped to budget and exposure cap |
| case-112 | Mile 12 Cooperative | tomato #9 | bid (llm) | Fair at 0.475, below my 0.55 cap | accepted |
| case-149 | Eko Court Residents | tomato #11 | bid (llm) | Fair at 0.431299, below my 0.45 cap | accepted |
| case-186 | Fjord Processing | haddock #14 | bid (llm) | Fair at 7.55, below my 9.1 cap | accepted |
| case-023 | Mile 12 Cooperative | tomato #11 | bid (llm) | Fair at 0.475, below my 0.55 cap | accepted |
| case-060 | Eko Court Residents | tomato #12 | bid (llm) | Fair at 0.410479, below my 0.45 cap | accepted |
| case-097 | Oslo Fiskehall | cod #1 | bid (llm) | Fair at 7.75, below my 8 cap | accepted |
| case-134 | Kestrel AI | gpu_hour #5 | bid (llm) | Fair at 1.892099, below my 1.95 cap | accepted |
| case-171 | Amstel Bloemen | rose #7 | bid (llm) | Fair at 4.141999, below my 4.2 cap | clamped: amount clamped to budget and exposure cap |
| case-008 | Oslo Fiskehall | haddock #13 | bid (llm) | Fair at 7, below my 8 cap | accepted |
| case-045 | Vector Mind | gpu_hour #4 | bid (llm) | Fair at 1.924599, below my 2 cap | clamped: amount clamped to budget and exposure cap |
| case-082 | Mile 12 Cooperative | tomato #9 | bid (llm) | Fair at 0.524699, below my 0.55 cap | accepted |
| case-119 | Eko Court Residents | tomato #11 | bid (llm) | Fair at 0.425, below my 0.45 cap | accepted |
| case-156 | Fjord Processing | haddock #14 | bid (llm) | Fair at 8.592999, below my 9.1 cap | accepted |
| case-193 | Kestrel AI | gpu_hour #4 | bid (llm) | Fair at 1.875, below my 1.95 cap | accepted |
| case-030 | Eko Court Residents | tomato #12 | bid (llm) | Fair at 0.395, below my 0.45 cap | accepted |
| case-067 | Oslo Fiskehall | cod #1 | bid (llm) | Fair at 7.872499, below my 8 cap | accepted |
| case-104 | Kestrel AI | gpu_hour #5 | bid (llm) | Fair at 1.875, below my 1.95 cap | accepted |
