import { env } from "../config"
import { townStore } from "../state/townStore"
import { createLiveLedger, createMockLedger, type LedgerClient } from "./ledger"

/** The app's ledger: Rabdi when VITE_ARKIV=live, else the mock ledger built from the replay. */
export const ledger: LedgerClient =
  env.arkiv.mode === "live"
    ? createLiveLedger(env.arkiv.accessKey)
    : createMockLedger(() => townStore.getState().ledger)
