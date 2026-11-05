import type { Building } from "@fairtown/shared/keys"

/** One sign per scene (S3 1.1): a neutral world town, no single-country skin. */
export const BUILDING_SIGNS: Record<Building, string> = {
  fish_dock: "Fish Dock · Bergen",
  freight_yard: "Freight Yard · Dallas to Houston",
  flower_hall: "Flower Hall · Mumbai · Nairobi to Amsterdam",
  harvest_hall: "Harvest Hall · Lagos, Mile 12",
  compute_yard: "Compute Yard",
  cold_vault: "Cold Vault",
  neighbourhood_pool: "Neighbourhood Pool",
  town_gate: "Town Gate",
}
