import { toBase, type Persona } from "@fairtown/shared"
import { keccak256, toHex } from "viem"

export const fixtureAgentId = (id: string) => `0x${keccak256(toHex(id)).slice(-40)}`

type Draft = Omit<Persona, "fixtureAgentId" | "budget"> & { budget: string }
const usd = (s: string) => toBase(s).toString()

const DRAFTS: Draft[] = [
  // sellers (6)
  { id: "ingrid", name: "Ingrid Solheim", role: "SELLER", kind: "seller", building: "fish_dock", sprite: "fisher", place: "bergen", currency: "EUR", budget: "0", sectors: ["fish"], scenes: ["bergen_cod"], bio: "Runs a small boat out of Bergen. Lands cod before dawn." },
  { id: "ganesh", name: "Ganesh Pawar", role: "SELLER", kind: "seller", building: "flower_hall", sprite: "farmer", place: "pune", currency: "USD", budget: "0", sectors: ["flowers"], scenes: ["diwali_marigold"], bio: "Grows marigolds near Pune. Diwali is his biggest week." },
  { id: "wanjiru", name: "Wanjiru Kamau", role: "SELLER", kind: "seller", building: "flower_hall", sprite: "farmer", place: "nairobi", currency: "EUR", budget: "0", sectors: ["flowers"], scenes: ["rose_flight"], bio: "Rose farm at Naivasha. Ships to Amsterdam by air." },
  { id: "amina", name: "Amina Bello", role: "SELLER", kind: "seller", building: "harvest_hall", sprite: "trader", place: "lagos", currency: "USD", budget: "0", sectors: ["produce"], scenes: ["lagos_cold"], bio: "Sells tomatoes at Mile 12 market in Lagos." },
  { id: "pedro", name: "Pedro Alvarez", role: "SELLER", kind: "seller", building: "harvest_hall", sprite: "farmer", place: "houston", currency: "USD", budget: "0", sectors: ["produce"], seeded: { proven: true }, scenes: ["dallas_return"], bio: "Onion farm outside Houston. Seeded as a proven seller, disclosed." },
  { id: "coastal_catch", name: "Coastal Catch", role: "SELLER", kind: "seller", building: "fish_dock", sprite: "fisher", place: "bergen", currency: "EUR", budget: "0", sectors: ["fish"], seeded: { noShow: true }, scenes: ["no_show"], bio: "Seeded seller that takes the advance and never hands over. Shown on purpose." },
  // buyers (12)
  { id: "hanse_kitchen", name: "Hanse Kitchen Group", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "chef", place: "hamburg", currency: "EUR", budget: usd("20000"), sectors: ["fish"], mandate: { commodities: ["cod", "haddock"], maxPerUnit: usd("9.40"), minGrade: "fresh_a", avoidNoShowSellers: true }, scenes: ["bergen_cod", "no_show"], bio: "Hamburg restaurant group. Buys Norwegian cod daily." },
  { id: "fjord_processing", name: "Fjord Processing", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "worker", place: "bergen", currency: "EUR", budget: usd("15000"), sectors: ["fish"], mandate: { commodities: ["cod", "haddock"], maxPerUnit: usd("9.10"), avoidNoShowSellers: true }, scenes: ["bergen_cod", "no_show"], bio: "Bergen fish processor." },
  { id: "oslo_fiskehall", name: "Oslo Fiskehall", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "chef", place: "oslo", currency: "EUR", budget: usd("8000"), sectors: ["fish"], mandate: { commodities: ["cod", "haddock"], maxPerUnit: usd("8.00"), avoidNoShowSellers: true }, scenes: ["bergen_cod", "no_show"], bio: "Fish hall in Oslo. Bids low, buys when others pass." },
  { id: "gulf_produce", name: "Gulf Produce", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "trader", place: "houston", currency: "USD", budget: usd("10000"), sectors: ["truck", "produce"], mandate: { commodities: ["truck_capacity", "onion", "tomato"], maxPerUnit: usd("0.07"), place: "dallas", avoidNoShowSellers: true }, scenes: ["dallas_return"], bio: "Houston wholesaler moving produce up from Dallas." },
  { id: "atlas_labs", name: "Atlas Labs", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "robot", place: "any_dc", currency: "USD", budget: usd("5000"), sectors: ["compute"], mandate: { commodities: ["gpu_hour"], maxPerUnit: usd("2.20"), avoidNoShowSellers: true }, scenes: ["gpu_night"], bio: "AI lab agent with its own compute budget." },
  { id: "kestrel_ai", name: "Kestrel AI", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "robot", place: "any_dc", currency: "USD", budget: usd("1500"), sectors: ["compute"], mandate: { commodities: ["gpu_hour"], maxPerUnit: usd("1.95"), avoidNoShowSellers: true }, scenes: ["gpu_night"], bio: "Small model shop that buys idle GPU hours." },
  { id: "vector_mind", name: "Vector Mind", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "robot", place: "any_dc", currency: "USD", budget: usd("400"), sectors: ["compute"], mandate: { commodities: ["gpu_hour"], maxPerUnit: usd("2.00"), avoidNoShowSellers: true }, scenes: ["gpu_night"], bio: "Research agent on a tight budget." },
  { id: "dadar_traders", name: "Dadar Flower Traders", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "trader", place: "mumbai", currency: "USD", budget: usd("6000"), sectors: ["flowers"], mandate: { commodities: ["marigold"], maxPerUnit: usd("1.20"), avoidNoShowSellers: true }, scenes: ["diwali_marigold"], bio: "Flower wholesaler at Dadar market, Mumbai." },
  { id: "pune_phool", name: "Pune Phool Mandi", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "trader", place: "pune", currency: "USD", budget: usd("2000"), sectors: ["flowers"], mandate: { commodities: ["marigold"], maxPerUnit: usd("1.00"), avoidNoShowSellers: true }, scenes: ["diwali_marigold"], bio: "Local flower market buyer in Pune." },
  { id: "bloom_co", name: "Bloom & Co", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "florist", place: "amsterdam", currency: "EUR", budget: usd("8000"), sectors: ["flowers", "truck"], mandate: { commodities: ["rose", "cargo_slot"], maxPerUnit: usd("4.80"), minGrade: "bloom_a", avoidNoShowSellers: true }, scenes: ["rose_flight"], bio: "Amsterdam florist buying roses for Valentine's Day." },
  { id: "amstel_bloemen", name: "Amstel Bloemen", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "florist", place: "amsterdam", currency: "EUR", budget: usd("3000"), sectors: ["flowers"], mandate: { commodities: ["rose"], maxPerUnit: usd("4.20"), avoidNoShowSellers: true }, scenes: ["rose_flight"], bio: "Second Amsterdam florist, bids conservatively." },
  { id: "mile12_coop", name: "Mile 12 Cooperative", role: "BUYER", kind: "buyer", building: "town_gate", sprite: "worker", place: "lagos", currency: "USD", budget: usd("5000"), sectors: ["produce", "storage"], mandate: { commodities: ["tomato", "storage_slot"], maxPerUnit: usd("0.55"), avoidNoShowSellers: true }, scenes: ["lagos_cold"], bio: "Traders' cooperative at Mile 12 market." },
  // trucks (4)
  { id: "lars", name: "Lars", role: "TRUCK", kind: "truck", building: "freight_yard", sprite: "driver", place: "bergen", currency: "EUR", budget: "0", sectors: ["truck"], scenes: ["bergen_cod"], bio: "Reefer truck between Bergen and Oslo." },
  { id: "maya", name: "Maya Torres", role: "TRUCK", kind: "truck", building: "freight_yard", sprite: "driver", place: "dallas", currency: "USD", budget: "0", sectors: ["truck"], seeded: { proven: true }, scenes: ["dallas_return"], bio: "Dallas truck owner. Seeded as proven, disclosed." },
  { id: "kofi", name: "Kofi Mensah", role: "TRUCK", kind: "truck", building: "freight_yard", sprite: "driver", place: "lagos", currency: "USD", budget: "0", sectors: ["truck"], scenes: ["lagos_cold"], bio: "Runs a box truck around Lagos markets." },
  { id: "nairobi_air_cargo", name: "Nairobi Air Cargo", role: "TRUCK", kind: "truck", building: "freight_yard", sprite: "pilot", place: "nairobi", currency: "EUR", budget: "0", sectors: ["truck"], scenes: ["rose_flight"], bio: "Sells cargo slots on the Nairobi to Amsterdam flight." },
  // cold stores (2)
  { id: "lagos_cold_hub", name: "Lagos Cold Hub", role: "STORAGE", kind: "cold_store", building: "cold_vault", sprite: "worker", place: "lagos", currency: "USD", budget: "0", sectors: ["storage"], scenes: ["lagos_cold"], bio: "Solar-powered cold room near Mile 12." },
  { id: "bergen_frost", name: "Bergen Frost", role: "STORAGE", kind: "cold_store", building: "cold_vault", sprite: "worker", place: "bergen", currency: "EUR", budget: "0", sectors: ["storage"], scenes: ["bergen_cod"], bio: "Freezer space at the Bergen harbour." },
  // societies (2)
  { id: "shanti_niwas", name: "Shanti Niwas", role: "SOCIETY", kind: "society", building: "neighbourhood_pool", sprite: "family", place: "mumbai", currency: "USD", budget: usd("1500"), sectors: ["produce", "flowers"], mandate: { commodities: ["tomato", "marigold"], maxPerUnit: usd("0.50"), avoidNoShowSellers: true }, scenes: ["lagos_cold"], bio: "Mumbai housing society agent pooling family orders." },
  { id: "eko_court", name: "Eko Court Residents", role: "SOCIETY", kind: "society", building: "neighbourhood_pool", sprite: "family", place: "lagos", currency: "USD", budget: usd("1000"), sectors: ["produce"], mandate: { commodities: ["tomato"], maxPerUnit: usd("0.45"), avoidNoShowSellers: true }, scenes: ["lagos_cold"], bio: "Lagos residents' pool buying tomatoes together." },
  // compute provider (1)
  { id: "northlight", name: "Northlight Compute", role: "SELLER", kind: "compute_provider", building: "compute_yard", sprite: "robot", place: "any_dc", currency: "USD", budget: "0", sectors: ["compute"], scenes: ["gpu_night"], bio: "GPU provider selling idle hours. Simulated in this demo, labelled." },
]

export const PERSONAS: Persona[] = DRAFTS.map((d) => ({ ...d, fixtureAgentId: fixtureAgentId(d.id) }))

export const persona = (id: string): Persona => {
  const p = PERSONAS.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown persona ${id}`)
  return p
}
