import { ReferenceResponse } from "@fairtown/shared/api"
import { readFileSync } from "node:fs"
import { z } from "zod"

const Row = ReferenceResponse.extend({ commodity: z.string(), market: z.string() })
export type ReferenceRow = z.infer<typeof Row>

export const loadReferences = (): ReferenceRow[] =>
  z.array(Row).parse(JSON.parse(readFileSync(new URL("../data/references.json", import.meta.url), "utf8")))

// Exact market first, then any market for the same commodity.
export function findReference(rows: ReferenceRow[], commodity: string, market: string): ReferenceRow | undefined {
  return rows.find((r) => r.commodity === commodity && r.market === market) ?? rows.find((r) => r.commodity === commodity)
}

export const toResponse = (r: ReferenceRow) => ReferenceResponse.parse(r)
