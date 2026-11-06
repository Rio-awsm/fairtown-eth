import { ARKIV_SDK_SCHEMAS } from "@fairtown/shared/arkiv"

/**
 * Arkiv schemas the browser reads (contract 10), namespace `fairtown.v1.`: the shared ones S2 writes with (D-110's
 * temporary copy typed `day` as u64 and `seller` as str; S2 writes `day` as a "YYYY-MM-DD" str and `seller` as addr).
 */
export const SCHEMAS = { price: ARKIV_SDK_SCHEMAS.price, reputation: ARKIV_SDK_SCHEMAS.reputation } as const
