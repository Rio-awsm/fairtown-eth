# Bidder eval (S2 5.1)

Provider: bidder=gemini-2.5-flash-lite. Decisions: 200. Overall: **PASS**.

| Metric | Value | Threshold | Result |
| --- | --- | --- | --- |
| Schema-valid on first try | 100.0% | >= 98.0% | pass |
| Fallback to rules | 0.0% | <= 10.0% | pass |
| p95 latency | 1745 ms | <= 4000 ms | pass |
| p50 latency | 1210 ms | | |

Fallbacks by cause: timeout 0, invalid_output 0, provider_error 0, rate_limited 0, mock_error 0, unusable 0.
Actions: bid 191, pass 9.
Guardrails on bids: accepted 157, clamped 34, rejected 0.

## 20 reasons to read aloud

| Case | Agent | Lot | Action | Reason | Guardrail |
| --- | --- | --- | --- | --- | --- |
| case-001 | Hanse Kitchen Group | cod #1 | bid (llm) | I will bid, aiming for the reference price. € | accepted |
| case-038 | Oslo Fiskehall | haddock #13 | bid (llm) | Fresh A grade haddock, I'll bid. | accepted |
| case-075 | Vector Mind | gpu_hour #4 | bid (llm) | New seller, I'll bid 1.92 for the verified grade. | clamped: amount clamped to budget and exposure cap |
| case-112 | Mile 12 Cooperative | tomato #9 | bid (llm) | Good grade and time left, I'll pay the clearing price. | accepted |
| case-149 | Eko Court Residents | tomato #11 | bid (llm) | Price is good, I'll bid $0.41 | accepted |
| case-186 | Fjord Processing | haddock #14 | bid (llm) | Fresh_A grade is good, I will bid €7.80. | accepted |
| case-023 | Mile 12 Cooperative | tomato #11 | bid (llm) | The grade is poor, so I'll go near the floor. | accepted |
| case-060 | Eko Court Residents | tomato #12 | bid (llm) | New seller, I'll bid low to test the waters. $0.35 | accepted |
| case-097 | Oslo Fiskehall | cod #1 | bid (llm) | Good grade, I'll bid to clear at €7.50. | accepted |
| case-134 | Kestrel AI | gpu_hour #5 | bid (llm) | I'll bid $1.85 because the grade is good and time is short. | accepted |
| case-171 | Amstel Bloemen | rose #7 | bid (llm) | new seller, I'll try a low bid to start | clamped: amount clamped to budget and exposure cap |
| case-008 | Oslo Fiskehall | haddock #13 | bid (llm) | Fresh A grade, I'll bid my max for this haddock. €8.00 | accepted |
| case-045 | Vector Mind | gpu_hour #4 | bid (llm) | Time is short, grade is good, buying at reference $1.99 | clamped: amount clamped to budget and exposure cap |
| case-082 | Mile 12 Cooperative | tomato #9 | bid (llm) | The grade is good and time is running out, so I'll bid. | accepted |
| case-119 | Eko Court Residents | tomato #11 | bid (llm) | New seller, I will test their price. $0.40/kg | accepted |
| case-156 | Fjord Processing | haddock #14 | bid (llm) | Fresh_a grade is good, but reference is low | accepted |
| case-193 | Kestrel AI | gpu_hour #4 | bid (llm) | I'll bid $1.80 because the clearing price is low. | accepted |
| case-030 | Eko Court Residents | tomato #12 | bid (llm) | Grade is class_2, will bid low for profit $ | accepted |
| case-067 | Oslo Fiskehall | cod #1 | bid (llm) | Fresh cod is good, I will bid near the reference. € | accepted |
| case-104 | Kestrel AI | gpu_hour #5 | bid (llm) | I'll bid $1.80 because it's the floor price. | accepted |
