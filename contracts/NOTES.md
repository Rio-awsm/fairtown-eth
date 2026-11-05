# Stream 1 notes

Gotchas, doc vs source mismatches and open questions. These feed `FEEDBACK.md`.

## 2026-11-06, S1 0.1

**`forge init --no-git` no longer means "don't create a repo".**
- Guide: `forge init --no-git contracts`.
- Foundry 1.9.0: `--no-git` means "install dependencies without adding them as submodules" (vendored copies).
- Used: `forge init --use-parent-git --empty --offline contracts`. No nested repo, no Counter example, no commit (forge only commits with `--commit`).

**`forge install` of CCA v2.1.0 fails, then silently rolls back.**
- `lib/liquidity-launcher/.gitmodules` (inside CCA) declares OpenZeppelin as `git@github.com:OpenZeppelin/openzeppelin-contracts.git`. Machines without a GitHub SSH key fail that clone ("Host key verification failed").
- `forge install` then deletes the submodule, `.gitmodules` and `.git/modules`, so it looks as if nothing happened.
- Workaround, used here and needed by anyone cloning the repo:
  ```sh
  git submodule update --init contracts/lib/continuous-clearing-auction
  git -C contracts/lib/continuous-clearing-auction -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init --recursive
  ```
  The `-c` rewrite applies to that one command only. It doesn't change global git config.
- Also: `git submodule add` records the default branch's HEAD. After `git checkout v2.1.0` in the submodule, the pointer must be re-staged (`git add contracts/lib/continuous-clearing-auction`), or the commit pins `main`.

**Dependencies come from CCA's own pins (D-37).**
- Guide: separate Permit2, OpenZeppelin and forge-std submodules.
- Chosen: one copy of each, remapped to CCA v2.1.0's `lib/`:
  - OpenZeppelin `e4f7021` (package.json 5.3.0)
  - Permit2 `cc56ad0` (canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` code)
  - forge-std v1.9.7, solady `2af0640` (v0.1.23), blocknumberish v1.1.0, liquidity-launcher v3.0.0, v4-periphery `60cd938`
- `auto_detect_remappings = false`. Auto-detection pulls about 60 nested remappings (optimism, kontrol, three more OZ copies). `remappings.txt` is explicit. One scoped entry: liquidity-launcher's `ProtocolFeeLib` imports `@uniswap/v4-core/`.

**CCA compile profile (D-36).**
- CCA's `foundry.toml`: `optimizer_runs = 11111`, plus a `via_ir` profile restricted to `src/ContinuousClearingAuctionFactory.sol`. Guide: optimizer 200.
- Chosen: our default 200, CCA's `via_ir` profile and restriction copied with 11111, path rewritten to `lib/continuous-clearing-auction/src/...`.
- Restrictions also apply to files that import the restricted file. Tests deploy the factory with `vm.deployCode(...)` and talk to it through `IContinuousClearingAuctionFactory`, so test files stay on the fast pipeline. `test/utils/CcaArtifacts.sol` is import-only, so forge builds the factory artifact at all. Without it nothing imports the factory and `vm.deployCode` has no artifact.
- CCA sets `ffi = true` for its own tests. We keep `ffi = false`.

**Sizes (forge 1.9.0, `forge build --sizes`).** `ContinuousClearingAuction` runtime 18,061 B, initcode 21,894 B. `ContinuousClearingAuctionFactory` runtime **24,214 B, 362 B under EIP-170**, because it embeds the auction's creation code. This is fixed by CCA's own profile, which we copied (D-36). Never compile the factory with fewer runs or other settings without rechecking the size. `LotFactory` must call the deployed factory, never embed it.

**No Permit2 on a plain local EVM.** `test_plainEvmHasNoPermit2` pins this. Integration tests must fork Base Sepolia or `vm.etch` Permit2. Permit2 is live on Base Sepolia with the expected EIP-712 domain (`ForkSmoke`).

**forge only reads the repo-root `.env` from the repo root.**
- `forge test --root contracts` (what `pnpm test:contracts` runs) loads `../.env`. `cd contracts && forge test` doesn't, so `ForkSmoke` skips with "RPC_URL unset".
- Checked with a throwaway project on 2026-11-06.

**Anvil prints the fork URL in its banner.** That URL can contain an RPC API key. `pnpm chain:fork` (`scripts/chain-fork.ts`) redacts it line by line.

## Open questions

- Should `contracts/.env` be a symlink to `../.env`, so `forge test` works from inside `contracts/`? Not done. Run from the repo root.
