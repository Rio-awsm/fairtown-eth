# Stream 1 rules
- Solidity 0.8.26, OpenZeppelin 5.x, no upgradeable proxies.
- CCA: code against lib/continuous-clearing-auction v2.1.0, NOT developers.uniswap.org.
- Bids pull currency via Permit2. Prices are Q96: use src/libraries/PriceMath.sol.
- Every lot state must have a timeout. Fuzz the payout invariant.
- Every event in 03_01_INTEGRATION_CONTRACT.md section 7 must exist with the exact signature.
- CRE: TypeScript + Bun, .result() not await, no Date.now()/randomness in node mode.
- Log every doc/source mismatch in contracts/NOTES.md.
