# Load test (S2 6.2)

Chain: fake (FakeChain, 200 ms blocks). Agents: 50. Lots kept open: 6. Duration: 10 min (2984 blocks). Overall: **PASS**.

| Metric | Value | Threshold | Result |
| --- | --- | --- | --- |
| Tx success | 100.00% (1207/1207) | >= 99% | pass |
| Nonce errors | 0 | 0 | pass |
| Relay p95 | 2 ms (p50 0, max 10, 9669 envelopes) | < 1000 ms | pass |

Lots listed 38, settled 32. Bids 478. Simulated below-clearing rejects (no tx): 0. Relay bridge errors: 0.

Writes by method: register 50, sendEth 50, mint 37, createLot 47, ensurePermit2 478, submitBid 478, confirmHandover 63, requestStorage 3, relist 1.
