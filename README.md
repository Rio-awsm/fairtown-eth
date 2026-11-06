# Fairtown

An open market for anything with an expiry date. AI agents and people bid in onchain auctions, sellers are paid in stages, and a live pixel town shows every bid. Built at ETHGlobal Mumbai 2026.

**Status:** work in progress. All money in this project is test money on testnets.

## Setup

Needs Node 22.10+ and pnpm 9 (the repo pins 9.15.9; pnpm 9.7+ switches to it automatically).

```bash
pnpm i
cp .env.example .env
pnpm run doctor
pnpm test
```

Use `pnpm run doctor`, not `pnpm doctor`: the second runs pnpm's own built-in check instead of ours.

## Arkiv

Fairtown keeps the public record of its market on Arkiv (network Rabdi, chain 7794095): every lot, bid, cleared price, seller record, truck or storage slot, demand signal and agent. Seller floors, seller advice and the bidding agents read it back. Details: [`arkiv/schema.md`](arkiv/schema.md), [`arkiv/how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md), [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md), [`arkiv/reach.md`](arkiv/reach.md), [`arkiv/friction.md`](arkiv/friction.md), [`arkiv/queries.md`](arkiv/queries.md).

**Writer wallet:** `0x8BA90d413a1b48321De0D77CCF8C201A7086b2ef` owns every Fairtown entity today (the 27 agent wallets take over their own lots and bids once funded on Rabdi; see schema.md). Explorer: https://rabdi.explorer.arkiv.network

**Run one query.** Get a free access key at https://hub.arkiv.network/access-keys, put it in `.env` as `ARKIV_ACCESS_KEY` (no private key needed), then:

```bash
pnpm -F agents arkiv:stats
```

It counts every `fairtown.v1.*` entity by schema and owner, then runs the query behind seller advice and listing floors: the last 10 cod prices at Bergen. Or, without this repo:

```ts
import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, desc, eq } from "@arkiv-network/sdk/query"
import { defineSchema, str, u256 } from "@arkiv-network/sdk/schema"
import { http } from "viem"

const price = defineSchema("fairtown.v1.price", {
  commodity: str().indexed(), place: str().indexed(), currency: str().indexed(), lotId: u256().indexed(),
  finalClearingPerUnit: u256().indexed(), avgPerUnit: u256().indexed(), soldUnits: u256().indexed(), day: str().indexed(),
})
const reader = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY! }), transport: http() })
const rows = await reader
  .select({ $key: true, $owner: true, lotId: true, finalClearingPerUnit: true, soldUnits: true, currency: true, day: true })
  .from(price).where(and(eq("commodity", "cod"), eq("place", "bergen"))).orderBy(desc("lotId")).limit(10).fetch()
console.log(rows.entities) // typed values, e.g. finalClearingPerUnit { type: "u256", value: "9000000" } = €9.00 per kg (6 decimals)
```

The entities on Rabdi as of 2026-11-06 come from a simulated market day (`pnpm -F agents arkiv:seed`), and each lot says so in `details.simulated`; lots sold on Base Sepolia in the demo are written by the same ledger writer.

## 0G: verifiable grading

**Without 0G, buyers can't verify which model graded the lot.** Every photo grade runs on the 0G Router (mainnet) with `verify_tee: true` and `X-0G-Provider-Trust-Mode: private`, on `0gm-1.0-35b-a3b`, the only TEE-attested (TeeML, TDX) image model the Router lists. The Router's `request_id`, provider address, model and badge state are stored in the lot's `details` on Arkiv, so anyone can see how a lot was graded.

The badge is honest in every state (`services/agents/src/ai/verification.ts`):

| State | When | Badge |
|---|---|---|
| verified | `x_0g_trace.tee_verified` is `true` | Verified model |
| failed | `tee_verified` is `false` | TEE check failed: grade untrusted (flagged, and it can't move the floor) |
| logged | 0G answered, no `tee_verified` returned | Model logged, TEE-only provider, signature not attested |
| fallback | 0G unavailable or out of credit; graded by our LiteLLM model | Graded by the fallback model, not on 0G: not attested |

**What we see today (2026-11-06):** the Router serves and logs every grade, but returns no `tee_verified` field, even with `verify_tee: true` and trust mode `private`, so our badge says "logged", not "verified". Request IDs from our probe (`pnpm -F agents probe:0g`): `a5071925-881d-41ce-aafa-0d5bc710cda9`, `22bd63fb-0945-44b0-b42a-5425c65a0709`, `88272dba-aa24-4d4b-91c8-385d5fc145bb`, all from provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`, about 2 to 4 s and 28 to 54 micro-USD per grade (thinking off). Dispute rulings on 0G run in CRE W3 (S1).

## ENS: agents as names (ENSv2, Sepolia)

Every agent is a name under `fairtown.eth` on ENSv2 Sepolia, owned by its own wallet: `ingrid.fairtown.eth`, `hanse-kitchen.fairtown.eth`, `lars.fairtown.eth` and so on. Records: `description`, `fairtown.role`, `fairtown.building`, `fairtown.mandate`, `fairtown.reputation` (the Arkiv query for its seller record), `fairtown.verified`, and the agent's address. Behind `ADDON_ENS=1`; with it off, addresses work as before.

- **Buyer agents resolve the seller's name through ENS before bidding** (Universal Resolver, then `.eth`, then our registry, then our resolver). If `fairtown.verified` says revoked, guardrails refuse the bid.
- **A no-show revokes the seller's verified role**: the name-level `ROLE_SET_RESOLVER` is revoked on chain and `fairtown.verified` becomes `revoked: N no-show(s), tx ...`.
- **Walk-ins and trucks get expiring names**: 2 hours for a walk-in (registered when they join), 3 days for a truck.
- The town shows `ensName` from `agent.spawned`.

| What | Address or tx |
|---|---|
| Parent `fairtown.eth` registration | [0x7744...2f04](https://sepolia.etherscan.io/tx/0x774438c6e9c9809dfe714923643a9b57ccc84e1f91114b4de0f856c4e5a82f04) |
| Our UserRegistry proxy (VerifiableFactory) | `0x0E66e1552AbA4017Fe2c8B5C75181d1627f06069` |
| Our PermissionedResolver proxy | `0x09974bd90778f069929286F492B5D730b3008AaE` |
| Service wallet (registrar, owns the parent) | `0x60D8Fb530450c3A001EE1924dc008dA33b294ac5` |

Reproduce: `pnpm -F agents ens:setup` (idempotent), `pnpm -F agents ens:agents` (27 names), `pnpm -F agents test:live` (register, resolve, revoke, unauthorised-registrar failure). The registry pattern follows ENS's contract-developer tutorial, which is marked educational and unaudited; here the service wallet itself holds `ROLE_REGISTRAR` instead of a registrar contract.

## Hedera: agents that pay for market intel (x402)

`GET /api/intel/:commodity` is an x402-protected endpoint that settles on **Hedera testnet** through the official facilitator (`https://x402.org/facilitator`, fee payer `0.0.9185802`). It returns recent clears for the commodity from the Arkiv ledger, live demand signals and the sellers with a no-show record. Price: 0.01 USDC (HTS token `0.0.429274`) or 0.05 HBAR. Behind `ADDON_HEDERA=1`.

**Payment flow, no human in it:**
1. A buyer agent (LLM strategy) looks at a lot and asks for intel on its commodity.
2. The endpoint answers `402` with a `PAYMENT-REQUIRED` header listing both prices and the merchant account.
3. The agent's client checks its policy: merchant host and pay-to account on the allowlist, per-call cap, its own remaining budget, and its balance from the mirror node. It prefers USDC and falls back to HBAR.
4. It signs the payment (`@x402/hedera` exact scheme) and retries with `PAYMENT-SIGNATURE`; the server verifies through the facilitator, builds the intel, settles, and returns the data with `PAYMENT-RESPONSE`.
5. The intel becomes one line in the bidder's prompt. It only informs the model; guardrails still decide every bid.

**Settled payment:** transaction `0.0.9185802@1793948661.406575988` ([HashScan](https://hashscan.io/testnet/transaction/0.0.9185802-1793948661-406575988)): 0.05 HBAR from buyer agent `0.0.11335677` to merchant `0.0.11335541`, `SUCCESS`, fee paid by the facilitator.

Spending controls (`services/agents/src/addons/hedera/buyer.ts`): per-agent budget per asset (0.20 USDC, 1 HBAR per run), per-call cap, merchant host and pay-to allowlist, plus the x402 client's own $0.10 per-payment cap; paid intel is cached 5 minutes so agents don't pay every tick. Reproduce: `pnpm -F agents hedera:setup`, then `pnpm -F agents hedera:pay cod`.

## Swarm: lot photos

With `ADDON_SWARM=1`, listing photos are also stored on Swarm through our own Bee light node, and each lot's Arkiv entity holds the photo hash and plain Swarm reference (`details.swarm`). The local disk stays the primary copy, so listing works with the node down. Example: Arkiv entity `0x86e0f000e218b880e15c98601d973914f11a3a1bec6f9e16be395220630332a1` holds reference `a7337bff060ca8052b299752151d1f453bda67dd5fcc7a71488873332d41cd68`, readable at https://bzz.limo/bzz/a7337bff060ca8052b299752151d1f453bda67dd5fcc7a71488873332d41cd68/. Batch, wallets, node and steps: [`arkiv/swarm.md`](arkiv/swarm.md).

## Licence

MIT. See `LICENSE`.
