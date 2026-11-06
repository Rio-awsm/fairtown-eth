import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useTown } from "../state/townStore"
import type { LedgerClient } from "./ledger"
import { queryText, type LedgerQuery } from "./queries"

/** Runs a ledger query: live polls every 5 s; mock re-runs whenever the replay adds a record. */
export function useLedgerQuery(client: LedgerClient, q: LedgerQuery) {
  const version = useTown((s) => s.ledger.price.length + s.ledger.reputation.length)
  return useQuery({
    queryKey: ["ledger", client.mode, queryText(q), q.limit, client.mode === "mock" ? version : 0],
    queryFn: () => client.run(q),
    refetchInterval: client.mode === "live" ? 5_000 : false,
    placeholderData: keepPreviousData,
  })
}
