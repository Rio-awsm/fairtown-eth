import type { SellerMessage } from "@fairtown/shared"

type E = SellerMessage["expected"]
const fish = (commodity: E["commodity"], qty: string, place: E["place"] = "bergen"): E => ({
  sector: "fish", commodity, qty, unit: "kg", place, currency: place === "oslo" || place === "bergen" ? "EUR" : "USD",
})

export const MESSAGES: SellerMessage[] = [
  { id: "m01", sellerId: "ingrid", text: "600 kg cod, landed 04:40, Bergen", expected: fish("cod", "600"), hard: false },
  { id: "m02", sellerId: "ingrid", text: "Landed 1.2 tonnes of skrei this morning in Bergen", expected: fish("cod", "1200"), hard: false },
  { id: "m03", sellerId: "coastal_catch", text: "400kg haddock Bergen ready 6am", expected: fish("haddock", "400"), hard: false },
  { id: "m04", sellerId: "ingrid", text: "800 lb cod at the Oslo dock", expected: fish("cod", "363", "oslo"), hard: false },
  { id: "m05", sellerId: "amina", text: "3 tonnes tomatoes at Mile 12 market Lagos", expected: { sector: "produce", commodity: "tomato", qty: "3000", unit: "kg", place: "lagos", currency: "USD" }, hard: false },
  { id: "m06", sellerId: "amina", text: "30 quintal tomato, Lagos, ready by noon", expected: { sector: "produce", commodity: "tomato", qty: "3000", unit: "kg", place: "lagos", currency: "USD" }, hard: false },
  { id: "m07", sellerId: "ganesh", text: "2 tonnes marigold near Pune for Diwali", expected: { sector: "flowers", commodity: "marigold", qty: "2000", unit: "kg", place: "pune", currency: "USD" }, hard: false },
  { id: "m08", sellerId: "ganesh", text: "genda phool 15 quintal Pune", expected: { sector: "flowers", commodity: "marigold", qty: "1500", unit: "kg", place: "pune", currency: "USD" }, hard: false },
  { id: "m09", sellerId: "wanjiru", text: "500 kg roses from Naivasha, need Amsterdam cargo by Friday", expected: { sector: "flowers", commodity: "rose", qty: "500", unit: "kg", place: "nairobi", currency: "EUR" }, hard: false },
  { id: "m10", sellerId: "wanjiru", text: "about half a tonne of roses, maybe more", expected: { sector: "flowers", commodity: "rose", qty: "500", unit: "kg", place: "nairobi", currency: "EUR" }, hard: true },
  { id: "m11", sellerId: "pedro", text: "5 tonnes onions Houston", expected: { sector: "produce", commodity: "onion", qty: "5000", unit: "kg", place: "houston", currency: "USD" }, hard: false },
  { id: "m12", sellerId: "pedro", text: "11000 lbs of onions in Houston", expected: { sector: "produce", commodity: "onion", qty: "4990", unit: "kg", place: "houston", currency: "USD" }, hard: false },
  { id: "m13", sellerId: "maya", text: "18,000 kg of space Dallas to Houston leaving 2pm", expected: { sector: "truck", commodity: "truck_capacity", qty: "18000", unit: "kg_route", place: "dallas", currency: "USD" }, hard: false },
  { id: "m14", sellerId: "lars", text: "Reefer with 2 t free, Bergen to Oslo tonight", expected: { sector: "truck", commodity: "truck_capacity", qty: "2000", unit: "kg_route", place: "bergen", currency: "EUR" }, hard: false },
  { id: "m15", sellerId: "northlight", text: "200 GPU hours from 02:00, H100", expected: { sector: "compute", commodity: "gpu_hour", qty: "200", unit: "gpu_hour", place: "any_dc", currency: "USD" }, hard: false },
  { id: "m16", sellerId: "northlight", text: "idle cluster: 64 gpu hrs tonight", expected: { sector: "compute", commodity: "gpu_hour", qty: "64", unit: "gpu_hour", place: "any_dc", currency: "USD" }, hard: false },
  { id: "m17", sellerId: "lagos_cold_hub", text: "20 slot-days of cold storage free in Lagos", expected: { sector: "storage", commodity: "storage_slot", qty: "20", unit: "slot_day", place: "lagos", currency: "USD" }, hard: false },
  { id: "m18", sellerId: "nairobi_air_cargo", text: "Cargo space 1.5 tonnes Nairobi to Amsterdam Thursday", expected: { sector: "truck", commodity: "cargo_slot", qty: "1500", unit: "kg_route", place: "nairobi", currency: "EUR" }, hard: false },
  { id: "m19", sellerId: "bergen_frost", text: "10 slot-days cold storage Bergen", expected: { sector: "storage", commodity: "storage_slot", qty: "10", unit: "slot_day", place: "bergen", currency: "EUR" }, hard: false },
  { id: "m20", sellerId: "ingrid", text: "cod ~600, bergen", expected: fish("cod", "600"), hard: true },
]
