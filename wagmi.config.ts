import { defineConfig } from "@wagmi/cli"
import { foundry } from "@wagmi/cli/plugins"

// pnpm gen:abi -> packages/shared/src/abi/generated.ts (contract section 9: our contracts, CCA and Permit2).
// Artifacts are listed by name so test helpers, mocks and CCA's own dependencies stay out.
export default defineConfig({
  out: "packages/shared/src/abi/generated.ts",
  plugins: [
    foundry({
      project: "contracts",
      forge: { build: true, rebuild: true },
      include: [
        "MockStable.json",
        "LotToken.json",
        "AgentRegistry.json",
        "AgentRegistryHook.json",
        "LotFactory.json",
        "MarketSettlement.json",
        "ChainTrigger.json",
        "SignalOracle.json",
        "DisputeResolver.json",
        "ContinuousClearingAuction.json",
        "ContinuousClearingAuctionFactory.json",
        "IAllowanceTransfer.json",
      ],
    }),
  ],
})
