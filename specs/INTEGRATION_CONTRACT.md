# Fairtown: Integration Contract

Updated 5 Nov 2026 · @Digitalyz

## How to use this document

This is the single agreement between the three streams: **version v1, frozen at the end of C 0.1**. Every stream codes against it, using mocks until the real thing exists, and it changes only through an Interface Change Request (section 16).

If code and this document disagree, this document wins until an ICR changes it. Step IDs such as `S1 1.2` or `C 2.3` refer to the stream and combine guides.

| Section | What it fixes | Main consumers |
| --- | --- | --- |
| 1 to 4 | Repo, versions, ports, env | Everyone |
| 5 and 6 | Units, Q96, keys | Everyone |
| 7 and 8 | Contracts, events, deployment file | S2, S3 |
| 9 and 10 | Shared package, Arkiv schemas | S2, S3 |
| 11 and 12 | REST API, relay protocol | S3, S1 |
| 13 and 14 | Mocks, fixtures, scripts, doctor | Everyone |
| 15 and 16 | Templates, ICR log | Everyone |

---

## 1. Monorepo layout

```
fairtown/
  CLAUDE.md  DECISIONS.md  MILESTONES.md  README.md  FEEDBACK.md  AI_USAGE.md  LICENSE  .env.example
  package.json  pnpm-workspace.yaml
  specs/                         # source of truth and these guides
  prompts/{stream-1,stream-2,stream-3,combine}/
  packages/shared/               # @fairtown/shared (ICR only)
    src/abi/generated.ts  addresses.ts  units.ts  keys.ts  protocol.ts  api.ts  arkiv.ts  handover.ts
    fixtures/                    # day.jsonl, lots.json, agents.json, messages.json, photos/, references.json
  contracts/                     # S1: Foundry
  cre/                           # S1: w1-fx-reference/  w2-signals/  w3-rulings/
  services/
    keeper/                      # S1
    agents/                      # S2: runtime, REST, AI gateway, director
    relay/                       # S2
    addons/                      # S2: ens/ world/ hedera/ (all optional)
  apps/web/                      # S3
  arkiv/                         # schema.md friction.md reach.md why-arkiv.md how-you-use-arkiv.md queries.md
  deployments/                   # base-sepolia.json, anvil.json
  docs/demo/
```

---

## 2. Toolchain and pinned versions (checked 5 Nov)

| Tool or library | Version | Used by |
|---|---|---|
| Node | 22.10+ | all TS |
| pnpm | 9.x | workspaces |
| Foundry | latest 1.x | S1 |
| Solidity | 0.8.26 | S1 |
| Uniswap CCA | tag **v2.1.0** | S1 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | S1, S2 |
| OpenZeppelin Contracts | 5.x (`EIP712`, `SignatureChecker`, `SafeERC20`, `ReentrancyGuard`, `AccessControl`) | S1 |
| Bun | 1.2+ | CRE tests |
| `@chainlink/cre-sdk` | 1.23.x | S1 |
| viem | 2.x, one version | all |
| `@wagmi/cli` + foundry plugin | latest 2.x | shared |
| zod | version required by `ai` | all |
| `ai` | 7.x | S2 |
| `@ai-sdk/openai-compatible` | matching 7.x line | S2 |
| `@arkiv-network/sdk` | **1.0.x** on Rabdi | S2, S3 |
| `@0gfoundation/0g-compute-ts-sdk` | 0.9.x, optional | S2 |
| `ws`, Fastify | 8.x, latest | S2 |
| Phaser | 4.2.x | S3 |
| React, Vite | from template | S3 |
| easystarjs | 0.4.4 | S3 |
| `qrcode` | 1.5.x | S3 |
| `@yudiel/react-qr-scanner` | 2.6.x | S3 |
| Vitest, Playwright, MSW 2, concurrently | latest | S2, S3 |
| `@x402/core`, `@x402/hedera` | latest, optional | S2 add-on |

**Rule:** one version of viem and zod in the whole monorepo.

---

## 3. Ports and processes

| Process | Command | Port | Owner |
|---|---|---|---|
| Anvil fork | `pnpm chain:fork` | 8545 | S1 |
| Agents | `pnpm -F agents dev` | **8787** | S2 |
| Relay | `pnpm -F relay dev` | **8788** | S2 |
| Keeper | `pnpm -F keeper dev` | none | S1 |
| CRE bridge | `pnpm -F keeper cre:bridge` | **8789** | S1 |
| Web | `pnpm -F web dev` | **8080** | S3 |
| Add-ons | `pnpm -F addons dev` | **8790** | S2 |
| Ollama | `ollama serve` | 11434 | S2 |
| Tunnel | `cloudflared tunnel --url http://localhost:8080` | none | S3 |

---

## 4. Environment variables (`.env.example`)

```bash
# ---------- network ----------
CHAIN_MODE=base-sepolia            # fake | anvil | base-sepolia
CHAIN_ID=84532
RPC_URL=https://sepolia.base.org
RPC_WS_URL=
FORK_RPC_URL=${RPC_URL}
EXPLORER_URL=https://sepolia.basescan.org
ETHERSCAN_API_KEY=

# ---------- keys (testnet only) ----------
DEPLOYER_PRIVATE_KEY=
OPERATOR_PRIVATE_KEY=
KEEPER_PRIVATE_KEY=
AGENT_MNEMONIC=
TREASURY_ADDRESS=

# ---------- protocol params ----------
FEE_BPS=100
ADVANCE_NEW_BPS=5000
ADVANCE_PROVEN_BPS=9000
ADVANCE_TRUCK_BPS=1000
PROVEN_AFTER_CLEAN_LOTS=3
CONTEST_WINDOW_BLOCKS=600
REPORT_WINDOW_BLOCKS=3000
PICKUP_WINDOW_FISH=3000
PICKUP_WINDOW_FLOWERS=3000
PICKUP_WINDOW_PRODUCE=4500
PICKUP_WINDOW_TRUCK=3000
PICKUP_WINDOW_STORAGE=1500
PICKUP_WINDOW_COMPUTE=600
RELIST_STEP_BPS=1500
LAST_BLOCK_SHARE_BPS=7500

# ---------- Arkiv ----------
ARKIV_MODE=live                    # live | memory
ARKIV_ACCESS_KEY=
ARKIV_PRIVATE_KEY=

# ---------- AI (all pluggable) ----------
MOCK_AI=0
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=local
BIDDER_MODEL=
LISTING_MODEL=
VISION_BASE_URL=${LLM_BASE_URL}    # 0G: https://router-api.0g.ai/v1
VISION_API_KEY=${LLM_API_KEY}
VISION_MODEL=
VISION_EXTRA_BODY=                 # 0G: {"verify_tee":true}
STT_PROVIDER=webspeech
STT_BASE_URL=${LLM_BASE_URL}
STT_MODEL=
STT_LANGUAGE=en-US

# ---------- data ----------
FX_URL=https://api.frankfurter.dev/v2/rates
OPEN_METEO_URL=https://api.open-meteo.com/v1/forecast
DATA_GOV_IN_API_KEY=               # optional adapter
USDA_MARS_API_KEY=                 # optional adapter

# ---------- CRE ----------
CRE_ETH_PRIVATE_KEY=
CRE_TARGET=local-simulation
CRE_FORWARDER_BASE_SEPOLIA=0x82300bd7c3958625581cc2f77bc6464dcecdf3e5

# ---------- add-ons, all off by default ----------
ADDON_ENS=0
ENS_SEPOLIA_RPC_URL=
ENS_PARENT_NAME=fairtown.eth
ADDON_WORLD=0
WORLD_CLIENT_ID=
WORLD_CLIENT_SECRET=
ADDON_HEDERA=0
HEDERA_ACCOUNT_ID=
HEDERA_PRIVATE_KEY=
X402_FACILITATOR_URL=https://x402.org/facilitator

# ---------- services ----------
AGENTS_PORT=8787
RELAY_PORT=8788
CRE_BRIDGE_PORT=8789
WEB_PORT=8080
ADDONS_PORT=8790
RELAY_INTERNAL_TOKEN=change-me
CRE_BRIDGE_TOKEN=change-me
STORAGE_DIR=./.data
PUBLIC_BASE_URL=http://localhost:8787
PUBLIC_WEB_URL=https://<tunnel>.trycloudflare.com
VITE_API_URL=http://localhost:8787
VITE_RELAY_URL=ws://localhost:8788/ws
VITE_EXPLORER_URL=https://sepolia.basescan.org
```

---

## 5. Units and conventions

| Thing | Offchain | Onchain |
|---|---|---|
| Money | `bigint` base units of the lot's currency, as decimal strings across JSON | 6 decimals. `1_000_000` = 1.00 |
| Currency | `USD`, `EUR` on `tUSD`, `tEUR`; proof lot `USDC` | ERC-20 from `LotFactory` allowlist |
| Local display | Number from daily FX, display only | Never onchain in payouts |
| Quantity | Whole units: `kg`, `kg_route`, `slot_day`, `gpu_hour` | LotToken 18 decimals |
| Price per unit | Base units per unit (`perUnit`) | CCA Q96: `perUnit * 2^96 / 1e18` |
| Average paid | `avgPerUnit` | `raised * 1e18 / soldTokens` |
| Tick | About 1% of floor | `max(2, floorQ96 / 100)`, floor rounded to a multiple |
| Bid price | Must be on a tick, above clearing | `ceilToTick(perUnitQ96)` |
| Bid amount | Currency base units | `uint128` |
| Time | Blocks, about 2s | `uint64` |
| Keys | Lowercase snake strings | `bytes32` through `stringToHex(s, { size: 32 })` |
| IDs | `lotId` uint256; `agentId` lowercase address | |

**Minimum floor:** CCA needs `floorQ96 >= 2^32 + 1`. One base unit per unit gives `79228162514`, which passes, so this limit never matters in practice. Product minimum `perUnit >= 1_000` (0.001).

```ts
export const Q96 = 2n ** 96n
export const UNIT = 10n ** 18n
export const toQ96 = (perUnit: bigint) => (perUnit * Q96) / UNIT
export const fromQ96 = (q: bigint) => (q * UNIT) / Q96
export const tickFor = (floorQ96: bigint) => (floorQ96 / 100n > 2n ? floorQ96 / 100n : 2n)
export const floorToTick = (q: bigint, tick: bigint) => (q / tick) * tick
export const ceilToTick = (q: bigint, tick: bigint) => ((q + tick - 1n) / tick) * tick
export const toBase = (amount: string) => parseUnits(amount, 6)
export const splitPayout = (raised: bigint, feeBps: bigint, advanceBps: bigint) => {
  const fee = (raised * feeBps) / 10000n
  const net = raised - fee
  const advance = (net * advanceBps) / 10000n
  return { fee, advance, held: net - advance }
}
```

---

## 6. Canonical enums (`@fairtown/shared/keys`)

```ts
export const SECTORS = ["produce", "fish", "flowers", "truck", "storage", "compute"] as const
export const BUILDINGS = ["harvest_hall", "fish_dock", "flower_hall", "freight_yard", "cold_vault", "neighbourhood_pool", "compute_yard", "town_gate"] as const
export const MARKET_OF_SECTOR = { produce: "harvest_hall", fish: "fish_dock", flowers: "flower_hall", truck: "freight_yard", storage: "cold_vault", compute: "compute_yard" } as const
export const COMMODITIES = ["cod", "haddock", "tomato", "onion", "marigold", "rose", "truck_capacity", "cargo_slot", "storage_slot", "gpu_hour"] as const
export const UNITS = { produce: "kg", fish: "kg", flowers: "kg", truck: "kg_route", storage: "slot_day", compute: "gpu_hour" } as const
export const PLACES = ["bergen", "oslo", "hamburg", "dallas", "houston", "mumbai", "pune", "nairobi", "amsterdam", "lagos", "any_dc"] as const
export const CURRENCIES = ["USD", "EUR", "USDC"] as const
export const DISPLAY_CURRENCIES = ["USD", "EUR", "NOK", "INR", "KES", "NGN"] as const
export const ROLES = { NONE: 0, SELLER: 1, BUYER: 2, TRUCK: 3, STORAGE: 4, SOCIETY: 5, HUMAN: 6 } as const
export const SIGNAL_KINDS = ["weather", "festival", "demand_dip", "reference"] as const
export const GRADES = ["extra", "class_1", "class_2", "fresh_e", "fresh_a", "fresh_b", "unfit", "bloom_a", "bloom_b", "gpu_verified", "na"] as const
export const LOT_STATUS = ["open", "unsold", "sold", "truck_booked", "picked_up", "paid_in_full", "delivered", "no_show_reported", "disputed", "refunded", "relisted"] as const
export const toKey = (s: string) => stringToHex(s, { size: 32 })
```

Adding a value is a minor ICR. Removing or renaming is major.

---

## 7. Contract interfaces (S1 implements)

Event names and argument order are frozen in v1.

### 7.1 `MockStable` (`tUSD`, `tEUR`)
```solidity
// ERC20, 6 decimals. Testnet only. Name "Test USD" / "Test EUR".
function mint(address to, uint256 amount) external;        // onlyOperator
function drip(address to) external;                        // public, 5,000 units per address per 24h
```

### 7.2 `AgentRegistry`
```solidity
function register(address agent, uint8 role, string calldata name) external; // onlyOperator
function setRole(address agent, uint8 role) external;                        // onlyOperator
function roleOf(address agent) external view returns (uint8);
function canBid(address agent) external view returns (bool);   // BUYER, SOCIETY, HUMAN
function canList(address agent) external view returns (bool);  // SELLER, TRUCK, STORAGE
event AgentRegistered(address indexed agent, uint8 role, string name);
```

### 7.3 `AgentRegistryHook`
```solidity
// IValidationHook + ValidationHookIntrospection (ERC-165 id 0x22c44b5f)
function validate(uint256 maxPrice, uint128 amount, address owner, address sender, bytes calldata hookData) external;
// reverts unless sender == owner && registry.canBid(owner)
```

### 7.4 `LotFactory`
```solidity
struct LotSpec {
    bytes32 sector; bytes32 market; bytes32 commodity; bytes32 grade; bytes32 place;
    address currency;          // from allowlist
    uint256 qty;               // whole units
    uint256 floorPerUnit;      // currency base units per unit
    uint64  durationBlocks;
    uint64  pickupWindowBlocks;
    uint256 parentLotId;       // 0 = none; set for chained lots and relists
    address seller;
    string  metadataURI;
}
struct Lot {
    LotSpec spec; address auction; address token; uint64 startBlock; uint64 endBlock;
    uint256 floorQ96; uint256 tickSpacingQ96; uint8 status;
    // 0 OPEN, 1 SETTLED, 2 RELISTED, 3 CLOSED. Detailed status lives in settlement views.
}
function createLot(LotSpec calldata spec) external returns (uint256 lotId, address auction, address token); // caller canList or operator
function createRelistedLot(LotSpec calldata spec) external returns (uint256 lotId, address auction, address token); // only settlement
function setCurrency(address currency, bool allowed) external; // onlyOperator
function isCurrency(address currency) external view returns (bool);
function getLot(uint256 lotId) external view returns (Lot memory);
function lotCount() external view returns (uint256);
event LotListed(uint256 indexed lotId, address indexed seller, bytes32 indexed market, address auction, address token, address currency,
                bytes32 sector, bytes32 commodity, bytes32 place, uint256 qty, uint256 floorPerUnit, uint64 startBlock, uint64 endBlock,
                uint256 parentLotId, string metadataURI);
```

### 7.5 `MarketSettlement`
```solidity
// --- sale ---
function settle(uint256 lotId) external;                           // anyone, block >= endBlock, once
function relist(uint256 lotId, uint256 newFloorPerUnit, uint64 durationBlocks) external returns (uint256 newLotId); // seller or operator, unsold > 0, lower floor, burns unsold, new token
function reclaimUnsold(uint256 lotId) external;                    // seller, after settle

// --- transport ---
function assignCarrier(uint256 lotId, uint256 truckLotId) external; // anyone; truck lot settled, parent matches, carrier = truck seller

// --- handover ---
function confirmHandover(uint256 lotId, address buyer, uint256 tokenAmount, uint64 expiryBlock, bytes calldata sellerSig) external;
// msg.sender is buyer or carrier(lotId). Seller signature over the EIP-712 Handover type. Burns tokens, pays held share to seller.
function handoverDigest(uint256 lotId, address buyer, uint256 tokenAmount, uint64 expiryBlock) external view returns (bytes32);

// --- no-show ---
function reportNoShow(uint256 lotId, uint256 tokenAmount) external;  // buyer, block > pickupDeadline, within report window; escrows tokens
function contestNoShow(uint256 lotId, address buyer, bytes32 evidenceHash, string calldata evidenceURI) external; // seller, in contest window; opens W3 ruling
function finalizeNoShow(uint256 lotId, address buyer) external;      // anyone, contest window over, uncontested; refunds held share, marks seller
function releaseExpired(uint256 lotId) external;                     // anyone, report window over; unclaimed held goes to seller

// --- rulings ---
function resolveRuling(uint256 lotId, address buyer, uint256 tokenAmount, uint16 refundBps) external; // only DisputeResolver

// --- seller record ---
function markProven(address seller, bool proven) external;           // onlyOperator; seeded demo sellers, disclosed
function advanceBpsFor(address seller, bytes32 sector) external view returns (uint16);
function sellerRecord(address seller) external view returns (uint32 cleanLots, uint32 noShows, bool proven);

// --- views ---
function heldOf(uint256 lotId) external view returns (uint256 held, uint256 soldTokens, uint64 pickupDeadline, address carrier);
function statusOf(uint256 lotId) external view returns (uint8); // index into LOT_STATUS

event LotSettled(uint256 indexed lotId, uint256 finalClearingPerUnit, uint256 avgPerUnit, uint256 soldUnits, uint256 raised, uint256 sellerPaid, uint256 held, uint256 fee, uint16 advanceBps, uint64 pickupDeadline);
event LotRelisted(uint256 indexed lotId, uint256 indexed newLotId, uint256 newFloorPerUnit);
event CarrierAssigned(uint256 indexed lotId, uint256 indexed truckLotId, address indexed carrier);
event HandoverConfirmed(uint256 indexed lotId, address indexed buyer, address indexed receiver, uint256 tokenAmount, uint256 releasedToSeller);
event LotPaidInFull(uint256 indexed lotId);
event LotDelivered(uint256 indexed lotId, uint256 truckLotId);  // truckLotId 0 means direct pickup
event NoShowReported(uint256 indexed lotId, address indexed buyer, uint256 tokenAmount, uint64 contestEnds);
event NoShowContested(uint256 indexed lotId, address indexed buyer, uint256 indexed disputeId);
event NoShowRefunded(uint256 indexed lotId, address indexed seller, address indexed buyer, uint256 refund);
event HeldReleased(uint256 indexed lotId, uint256 amount);
event RulingSettled(uint256 indexed lotId, address indexed buyer, uint256 refundToBuyer, uint256 paidToSeller);
event SellerRecordUpdated(address indexed seller, uint32 cleanLots, uint32 noShows, bool proven);
```

**Rules:**
- EIP-712: name `Fairtown`, version `1`, type `Handover(uint256 lotId,address buyer,uint256 tokenAmount,uint64 expiryBlock)`.
- Direct pickup emits `LotDelivered(lotId, 0)`. When a truck lot with `parentLotId` receives its handover, emit `LotDelivered(parentLotId, truckLotId)`.
- `LotPaidInFull(lotId)` fires when the lot's held money is fully released and, if a carrier was assigned, the truck lot's held money is too. Screen order is always Sold, Truck booked, Picked up, Delivered, Paid in full.
- A lot counts as clean when all its held money went to the seller with no refund. `cleanLots` then rises by one.
- A finalized no-show increments `noShows`, resets `cleanLots` to 0 and clears the proven flag.
- Rounding dust from shares goes to the seller on the final release.
- **Invariants:** `sellerPaid + fee + held == raised`. Finally: `seller + buyers + treasury == raised`.

### 7.6 `ChainTrigger`
```solidity
function onSettled(uint256 lotId) external;                        // only settlement
function requestStorage(uint256 lotId, uint256 qty, uint16 days_) external; // holder of that lot's tokens
event TransportNeeded(uint256 indexed lotId, bytes32 indexed fromMarket, bytes32 place, uint256 qty, uint64 readyByBlock);
event StorageNeeded(uint256 indexed lotId, address indexed requester, uint256 qty, uint16 days_);
```
`onSettled` emits `TransportNeeded` for `produce`, `fish`, `flowers` when `soldUnits > 0`.

### 7.7 `SignalOracle` (`IReceiver`)
```solidity
function onReport(bytes calldata metadata, bytes calldata report) external; // only forwarder
// report = abi.encode(uint8 kind, bytes body)
// kind 1 reference: abi.encode(bytes32 commodity, bytes32 market, uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag)
// kind 2 signal:    abi.encode(bytes32 signalKind, bytes32 place, uint8 severity, uint64 expiresAtBlock, string label)
// kind 3 fx:        abi.encode(bytes32 currencyCode, uint256 perUsdE8)
function referencePrice(bytes32 commodity, bytes32 market) external view returns (uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 updatedAt);
function fxRate(bytes32 currencyCode) external view returns (uint256 perUsdE8, uint64 updatedAt);
event ReferencePriceUpdated(bytes32 indexed commodity, bytes32 indexed market, uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 updatedAt);
event FxUpdated(bytes32 indexed currencyCode, uint256 perUsdE8, uint64 updatedAt);
event DemandSignal(uint256 indexed id, bytes32 indexed signalKind, bytes32 indexed place, uint8 severity, uint64 expiresAtBlock, string label);
```

### 7.8 `DisputeResolver` (`IReceiver`)
```solidity
function openDispute(uint256 lotId, uint256 tokenAmount, bytes32 evidenceHash, string calldata evidenceURI) external; // buyer; before handover and deadline + report window; escrows tokens
function openNoShowRuling(uint256 lotId, address buyer, uint256 tokenAmount, bytes32 evidenceHash, string calldata evidenceURI) external returns (uint256 disputeId); // only settlement
function onReport(bytes calldata metadata, bytes calldata report) external; // only forwarder
// report = abi.encode(uint256 disputeId, uint16 refundBps, bytes32 reasonHash)
event DisputeOpened(uint256 indexed disputeId, uint256 indexed lotId, address indexed buyer, uint8 kind, uint256 tokenAmount, bytes32 evidenceHash, string evidenceURI); // kind 0 quality, 1 no_show
event DisputeResolved(uint256 indexed disputeId, uint256 indexed lotId, uint16 refundBps, bytes32 reasonHash);
```

### 7.9 CCA events consumed (from v2.1.0 source, checked)
```solidity
event BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount);
event CheckpointUpdated(uint256 blockNumber, uint256 clearingPriceQ96, uint24 cumulativeMps);
event ClearingPriceUpdated(uint256 blockNumber, uint256 clearingPriceQ96);
event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded);
event TokensClaimed(uint256 indexed bidId, address indexed owner, uint256 tokensFilled);
event TokensReceived(uint128 totalSupply);
```

---

## 8. Deployment file (`deployments/<network>.json`)

```json
{
  "network": "base-sepolia",
  "chainId": 84532,
  "deployedAtBlock": 0,
  "commit": "<git sha>",
  "contracts": {
    "TestUSD": "0x...", "TestEUR": "0x...",
    "AgentRegistry": "0x...", "AgentRegistryHook": "0x...",
    "LotFactory": "0x...", "MarketSettlement": "0x...", "ChainTrigger": "0x...",
    "SignalOracle": "0x...", "DisputeResolver": "0x...", "CCAFactory": "0x..."
  },
  "external": {
    "Permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "CreForwarder": "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5",
    "CircleTestUSDC": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "CircleTestEURC": "0x808456652fdb597867f38412077A9182bf77359F"
  },
  "params": { "feeBps": 100, "advanceNewBps": 5000, "advanceProvenBps": 9000, "advanceTruckBps": 1000, "provenAfter": 3, "contestWindowBlocks": 60, "reportWindowBlocks": 300 }
}
```

---

## 9. Shared package exports

| Export | Contents |
|---|---|
| `abi` | Generated ABIs for our contracts, CCA and Permit2 |
| `addresses` | `loadDeployment(network)` |
| `units` | Section 5 helpers |
| `keys` | Section 6 enums, `toKey`, `fromKey` |
| `protocol` | `TownEvent`, `TownEnvelope`, `TownSnapshot` |
| `api` | REST schemas |
| `arkiv` | Section 10 schemas |
| `handover` | EIP-712 domain and types, `encodeTicket`, `decodeTicket` |
| `fixtures` | Day replay, lots, personas, messages, photos, references |

---

## 10. Arkiv schemas

Namespace `fairtown.v1.`, network Rabdi, SDK 1.0.x.

| Schema | Owner | Indexed columns | Stored | Expiry | Flags |
|---|---|---|---|---|---|
| `lot` | seller agent | sector, commodity, grade, market, place, currency, status, lotId, auction, floorPerUnit, endBlock, parentLotId | details (bytes JSON: photos' hashes, grade report, 0G request ID) | auction end + 1 day | |
| `bid` | buyer agent | lotId, agent, maxPerUnit, amount, block | reason | auction end + 1 hour | |
| `price` | writer | sector, commodity, grade, market, place, currency, lotId, finalClearingPerUnit, avgPerUnit, soldUnits, day | tx | 180 days | readonly, permissionlessExtension |
| `reputation` | writer | seller, tier, cleanLots, noShows, day | lastLotId, tx | 180 days | readonly, permissionlessExtension |
| `capacity` | truck or storage agent | kind, fromMarket, toPlace, qty, readyByBlock, lotId | notes | ready-by + 1 day | |
| `signal` | writer | kind, place, severity, expiresAtBlock | label | until expiry | |
| `agent` | agent wallet | role, name, building | mandate | 30 days | permissionlessExtension |

Rules:
- Chain is the truth for money. Arkiv is the public record and the live listing source.
- A `price` is written once on `LotSettled`. A new `reputation` is written on each `SellerRecordUpdated`; readers use the latest by `day` and key order.
- Lot `status` is patched by the seller's wallet as chain events arrive.
- Photos never go on Arkiv, only hashes or URLs. Payloads at most 100 KiB.

---

## 11. Agents REST API

JSON validated by `@fairtown/shared/api`. Errors: `{ error: { code, message } }`.

| Method and path | Request | Response | Used by |
|---|---|---|---|
| `GET /api/health` | | `{ ok, chain, arkiv, ai, addons }` | doctor, web |
| `POST /api/listings/draft` | `{ sellerId, text?, audioBase64?, photos?: [{dataUrl, lotCode, gps?, capturedAt}] }` | `LotDraft { draftId, sector, commodity, qty, unit, place, market, currency, grade, gradeReport, trace?, suggestedFloorPerUnit, reference?, display?, payoutPreview: {advanceBps, tier}, transcript? }` | seller chat |
| `POST /api/listings/confirm` | `{ draftId, floorPerUnit, durationBlocks }` | `{ lotId, auction, token, tx }` | seller chat |
| `GET /api/lots/meta/:draftId` | | Lot metadata JSON | anyone |
| `GET /api/lots/:lotId` | | `LotView` (spec, status, clearing, avg, bids[], settlement?) | panels |
| `GET /api/lots/:lotId/timeline` | | `{ steps: [{name, status, block?, tx?, deadlineBlock?}] }` | seller, buyer, town |
| `GET /api/sellers/:sellerId` | | Profile, tier, lots, payouts | seller chat |
| `GET /api/sellers/:sellerId/advice` | | `{ advice, basis }` | seller chat |
| `POST /api/buyers` | `{ name, role, currency, mandate, budget }` | `{ agentId, address }` | console |
| `GET /api/agents`, `GET /api/agents/:agentId` | | `AgentView` | panels |
| `PATCH /api/agents/:agentId` | `{ mandate?, paused? }` | `AgentView` | console |
| `POST /api/walkin` | `{ name, currency? }` | `{ agentId, address, token }` | walk-in |
| `POST /api/walkin/bid` | `{ token, lotId, maxPerUnit, amount }` | `{ bidId, tx }` | walk-in |
| `POST /api/handover/ticket` | `{ sellerId, lotId, buyer, tokenAmount }` | `{ ticket: {lotId, buyer, tokenAmount, expiryBlock, sig}, qrText, fallbackUrl }` | seller chat, truck |
| `POST /api/handover/confirm` | `{ receiverId, ticket }` | `{ tx, releasedToSeller }` | scan page |
| `POST /api/noshow/report` | `{ buyerId, lotId, tokenAmount }` | `{ tx, contestEnds }` | console |
| `POST /api/noshow/contest` | `{ sellerId, lotId, buyer, photos[] }` | `{ disputeId, tx }` | seller chat |
| `POST /api/disputes` | `{ buyerId, lotId, tokenAmount, photos[] }` | `{ disputeId, tx }` | console |
| `GET /api/disputes/:disputeId/evidence` | | `{ lotId, kind, listingPhotos[], handoverPhotos[], rubric, grade }` | CRE W3 |
| `POST /api/stt` | `{ audioBase64, language }` | `{ text, provider }` | seller chat |
| `GET /api/reference?commodity=&market=` | | `{ perUnit, currency, date, source, sourceUrl }` | CRE W1 |
| `GET /api/calendar?market=` | | `{ events: [{ name, date, market, sectorsAffected[], demandMultiplier, source }] }` | CRE W2 |
| `GET /api/fx` | | `{ base, rates, date, source }` | web |
| `POST /api/director/scenario` | `{ name: "bergen_cod" | "dallas_return" | "gpu_night" | "diwali_marigold" | "rose_flight" | "lagos_cold" | "no_show" | "full_day", speed? }` | `{ started }` | control |
| `GET /api/director/status` | | Scenario, step | control |

---

## 12. Relay protocol

### 12.1 Envelope
```ts
type TownEnvelope = { v: 1; id: string; ts: number; block?: number; source: "chain" | "arkiv" | "agents" | "director"; event: TownEvent }
```

### 12.2 Events
```ts
type TownEvent =
  | { type: "lot.listed"; lotId: string; building: Building; sector: Sector; commodity: string; qty: number; unit: string; currency: string; place: string;
      floorPerUnit: string; seller: string; sellerName: string; auction: string; endBlock: number; parentLotId: string; grade: string }
  | { type: "agent.spawned"; agentId: string; name: string; role: Role; building: Building; sprite: string; ensName?: string }
  | { type: "agent.intent"; agentId: string; action: "bid" | "pass" | "list" | "relist" | "move" | "handover" | "report_no_show"; moveTo?: Building; lotId?: string; reason: string }
  | { type: "bid.placed"; lotId: string; agentId: string; maxPerUnit: string; amount: string; tx: string }
  | { type: "price.tick"; lotId: string; clearingPerUnit: string }
  | { type: "lot.settled"; lotId: string; finalClearingPerUnit: string; avgPerUnit: string; soldUnits: string; sellerPaid: string; held: string; fee: string; advanceBps: number; pickupDeadline: number; tx: string }
  | { type: "lot.relisted"; lotId: string; newLotId: string; newFloorPerUnit: string }
  | { type: "transport.needed"; lotId: string; fromBuilding: Building; place: string; qty: string }
  | { type: "storage.needed"; lotId: string; requester: string; qty: string; days: number }
  | { type: "carrier.assigned"; lotId: string; truckLotId: string; carrier: string }
  | { type: "handover.confirmed"; lotId: string; buyer: string; receiver: string; releasedToSeller: string; tx: string }
  | { type: "lot.paid_in_full"; lotId: string }
  | { type: "lot.delivered"; lotId: string; truckLotId: string }
  | { type: "noshow.reported"; lotId: string; buyer: string; contestEnds: number }
  | { type: "noshow.contested"; lotId: string; buyer: string; disputeId: string }
  | { type: "noshow.refunded"; lotId: string; seller: string; buyer: string; refund: string }
  | { type: "seller.record"; seller: string; cleanLots: number; noShows: number; proven: boolean }
  | { type: "dispute.opened"; disputeId: string; lotId: string; buyer: string; kind: "quality" | "no_show" }
  | { type: "dispute.resolved"; disputeId: string; lotId: string; refundBps: number }
  | { type: "signal"; id: string; kind: SignalKind; place: string; severity: number; label: string; expiresAtBlock: number }
  | { type: "reference.updated"; commodity: string; market: string; perUnit: string; currency: string; source: string }
  | { type: "fx.updated"; currency: string; perUsd: number }
  | { type: "human.joined"; agentId: string; name: string }
  | { type: "clock"; block: number; phase?: "dawn" | "morning" | "noon" | "evening" | "night" }
```
All bigint values travel as decimal strings.

### 12.3 Snapshot (`GET /snapshot`)
```ts
type TownSnapshot = {
  block: number
  lots: Array<LotListedEvent & { status: LotStatus; clearingPerUnit?: string; avgPerUnit?: string; bids: number; pickupDeadline?: number }>
  agents: Array<{ agentId: string; name: string; role: Role; building: Building; sprite: string; ensName?: string }>
  signals: SignalEvent[]
  fx: Record<string, number>
  recent: TownEnvelope[]   // last 200
}
```
Clients load the snapshot, then subscribe to `/ws`. The relay de-duplicates by `id`.

### 12.4 Publishing offchain events
The agents service publishes `agent.*`, `human.joined` and `clock` phase events with `POST /internal/publish`, header `Authorization: Bearer ${RELAY_INTERNAL_TOKEN}`, body `TownEnvelope[]`. Chain-derived events come only from the relay.

---

## 13. Mock modes and fixtures

| Mode | Set by | Effect |
|---|---|---|
| `MOCK_AI=1` | env | Deterministic AI |
| `CHAIN_MODE=fake` | env | `FakeChain`, including staged payouts and tickets |
| `CHAIN_MODE=anvil` | env | Real contracts on a fork |
| `ARKIV_MODE=memory` | env | In-memory store |
| `RELAY --replay fixtures/day.jsonl` | flag | Replays recorded events |
| `VITE_RELAY_URL=mock` | env | In-browser replay |
| `VITE_API_URL=mock` | env | MSW handlers |

**Fixture rule:** whoever changes a shape updates fixtures in the same ICR PR. `fixtures/day.jsonl` is about 300 envelopes covering every event across the scenes in source of truth section 5.

---

## 14. Root scripts and doctor

| Script | Does |
|---|---|
| `pnpm gen:abi` | `forge build`, then wagmi to `abi/generated.ts` |
| `pnpm test` | TS workspace tests |
| `pnpm test:contracts` | `forge test` |
| `pnpm test:cre` | `bun test` in `cre` |
| `pnpm test:all` | All three |
| `pnpm chain:fork` | Anvil fork |
| `pnpm deploy:anvil`, `pnpm deploy:base-sepolia` | Deploy, write deployments, generate ABIs |
| `pnpm dev:all` | Relay, agents, keeper, web |
| `pnpm tunnel` | HTTPS tunnel for phones |
| `pnpm doctor` | Environment check |
| `pnpm e2e:day` | Full scripted day |

| Doctor check | Owner |
|---|---|
| Tool versions, env vars for the current modes | shared |
| RPC reachable, chain ID 84532, wallet balances | S1 |
| Deployment file and contract code | S1 |
| CRE CLI logged in, Frankfurter reachable | S1 |
| Arkiv chain ID 7794095, access key, optional test write | S2 |
| LLM endpoints and models, `tee_verified` probe if `VISION_EXTRA_BODY` is set | S2 |
| Agents funded (ETH, `tUSD`, `tEUR`, tGLM) | S2 |
| Add-on env when enabled | S2 |
| Ports free, HTTPS tunnel up | S2, S3 |

---

## 15. Templates

**`CLAUDE.md`:** see `03_00_START_HERE.md`. **`DECISIONS.md`:** copy D-00 to D-27 with columns Chosen, By, When; never delete rows.

**`MILESTONES.md`:**
```md
| ID | Title | Owner | Status | Started | Green at | Commit | Notes |
```
**Prompt log (`prompts/<stream>/<step>.md`):** tool and model, kickoff prompt, follow-ups, AI-generated files, human-written files, human decisions.

**Stream `NOTES.md`:** gotchas with time and workaround (these feed `FEEDBACK.md` and `friction.md`), open questions.

---

## 16. ICR log

| ID | Author | Change | Why | Affects | Acks | Status |
|---|---|---|---|---|---|---|
| ICR-000 | all | v1 frozen | Baseline | all | S1, S2, S3 | Pending C 0.1 |
| ICR-001 | S1 (maxspxtr) | Minor: add `packages/shared/fixtures/price-vectors.json` (20 vectors from Solidity `PriceMath`, written by `forge test`) and `packages/shared/test/price-vectors.test.ts`. No source or interface change | S1 1.1 requires TS and Solidity price math to match | shared | maxspxtr (S1) | Approved 2026-11-06 |
| ICR-002 | S1 (maxspxtr) | Minor: `LAST_BLOCK_SHARE_BPS` default 5000 -> 7500 in section 4 and `.env.example`. Value only, no interface change | S1 1.2 spread test: early vs late bidder at the same max were 10.7% apart at 5000, 4.5% at 7500 (target 5%) | S1, S2 (agents reading the schedule) | maxspxtr (S1) | Approved 2026-11-06 |
| ICR-003 | S1 (maxspxtr) | Minor: block windows x10 in section 4 and `.env.example` (contest 600, report 3000, pickup fish 3000, flowers 3000, produce 4500, truck 3000, storage 1500, compute 600). Auction durations x10 too (D-50): fish 450, flowers 600, produce 900, truck/storage/compute 300. Values only | Base Sepolia and Base mainnet measured at ~5 blocks/s (200 ms), not ~2 s; the old values ran 10x faster than SoT 14 intends (contest 12 s, pickup 60 s) | S1, S2 (agents, director timers), S3 (countdowns) | maxspxtr (S1) | Approved 2026-11-06 |
| ICR-004 | S2 (Rio-awsm) | Add `@fairtown/shared/env` (env loader moved from `scripts/doctor/env.ts`, node-only, not in the main index), `@fairtown/shared/fixtures` (`Persona`, `SellerMessage`, `SCENES`, `fixtureUrl`) and `fixtures/day.jsonl` (297 envelopes, all 24 event types, 7 scenes), `agents.json` (27 personas), `messages.json` (20 messages). Generated by `pnpm -F agents gen:fixtures` | S2 0.1 fixtures for S3; one tested env loader for services and doctor | S3, doctor | S2 | Minor, awaiting S3 ack |
| ICR-005 | S2 (Rio-awsm) | Add `@fairtown/shared/arkiv`: the seven section 10 schemas as descriptors (`ARKIV_SCHEMAS`: columns, indexed, owner, flags) and SDK schemas (`ARKIV_SDK_SCHEMAS`). Money columns are `u256`, blocks `u64`, addresses `addr`, `details`/`mandate` are `bytes` JSON. Adds `@arkiv-network/sdk` 1.0.1 to shared | S2 2.1; S3 reads Arkiv with the same schemas | S3 | S2 | Minor, awaiting S3 ack |

| ICR-006 | S2 (Rio-awsm) | Minor, section 11 and 4: new `POST /api/sessions/seller` `{ sellerId, pin }` -> `{ token, sellerId, expiresAt }` (2 h); `POST /api/handover/ticket` and `POST /api/noshow/contest` now need `Authorization: Bearer <seller session>` whose seller matches `sellerId` (401 no session, 403 wrong seller or not your lot). `fallbackUrl` is `${PUBLIC_WEB_URL}/scan#t=<base64url qrText>`. Walk-in bid response `{ bidId, tx }` (no shared schema yet). New env: `SELLER_PIN`, `TRUST_PROXY` (tunnel IP/CIDR), `WALKIN_BUDGET` (500), `WALKIN_CAP` (50), `LLM_MAX_RPM` (60, from S2 5.1), `CRE_BRIDGE_TOKEN` use, `CHAIN_BACKFILL_BLOCKS` (9000, S2 7.1), `VISION_TRUST_MODE`, `VISION_FALLBACK`, `VISION_FALLBACK_BASE_URL`, `VISION_FALLBACK_API_KEY`, `VISION_FALLBACK_MODEL` (S2 8.1). Draft `trace` (loose object) gains `model`, `fallback`, `verification: { state, label }`. No `packages/shared` code change | S2 6.1: the seller key signs only inside that seller's session (guide); no session existed in the contract | S3 `/sell`, `/scan`, `/walkin`; `.env.example` | S2 | Minor, proposed, awaiting S3 ack |
| ICR-007 | S2 (Rio-awsm) | Minor: add `packages/shared/fixtures/day.recorded.jsonl` (516 envelopes, `full_day` played on FakeChain, chain events mapped by the relay's `ChainMapper`, `ts` = day start + block x 2 s), generated by `pnpm -F agents record`. `GET /api/director/status` adds `running[]` and `log[]` next to `scenario` and `step` (schema is loose, no code change) | S2 6.2 recorded day for S3 replay and the demo fallback | S3 | S2 | Minor, proposed, awaiting S3 ack |
