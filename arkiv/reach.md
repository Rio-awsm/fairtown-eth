# Reach

## Who it is for

Sellers of things that lose value by the hour, and the buyers and carriers around them. The cast is fictional; the problem is not:

| Who | Today | Number (source) |
|---|---|---|
| Small fishers (Bergen) | sell through a sales organisation; prices public only in aggregate | Norwegian cod averaged NOK 97.67/kg in the 2026 winter fishery, up 31% on 2025 (Råfisklaget via The Fishing Daily) |
| Tomato sellers (Mile 12, Lagos) | sell into a glut with no cold storage | about 45% lost after harvest, about 50% in a glut (PwC and growers' association via BusinessDay) |
| Flower growers (Pune, Naivasha) | take the trader's price | farmers paid ₹20/kg while retail was ₹80 to 100/kg at Dussehra (Mumbai Live, Lokmat Times) |
| Truck owners (Dallas) | drive home empty | 20 to 35% of US truck miles are empty (Uber Freight via MarketScale) |
| GPU owners | leave capacity idle | about 5% average utilisation before optimisation (Cast AI via HPCwire, vendor report) |

For every one of them, the Arkiv part answers two questions they cannot answer today without trusting a middleman: **what did this actually sell for here recently** (`price`), and **does this seller hand over** (`reputation`). Buyer agents use the same two answers to decide whether to bid and how high.

## Would they use it?

The parts they would touch are built to need no crypto knowledge: the seller types "600 kg cod, Bergen", gets a suggested floor with its basis taken from Arkiv clears, and later sees "you're new: 50% at sale, the rest at handover; 2 more clean lots make you proven". They never see a wallet or gas. Whether real fishers or growers would switch is unproven: we have not put it in front of one. What we can show is that the record they would rely on is public, cannot be edited, and is readable by anyone.

## Can they try it today?

Yes, at three levels:
1. **Read the record on Arkiv now**, no account with us: get a free key at https://hub.arkiv.network/access-keys, then `pnpm -F agents arkiv:stats` (or the SDK snippet in the README). On 2026-11-06 it returns 12 lots, 65 bids, 12 prices, 15 seller records, 6 capacity slots and 27 agents, written by `0x8BA90d413a1b48321De0D77CCF8C201A7086b2ef`. These come from a simulated market day and are labelled so (`how-you-use-arkiv.md`); real Base Sepolia lots from the demo are added on top.
2. **Run the whole market locally** in mock mode (no keys): `pnpm install`, then `CHAIN_MODE=fake ARKIV_MODE=memory MOCK_AI=1 pnpm -F agents dev` and `pnpm -F relay dev`; start a scene with `POST /api/director/scenario {"name":"bergen_cod"}`.
3. **Join the live demo** from a phone through the walk-in QR (500 test dollars, 2-hour session) while it runs at ETHGlobal Mumbai.

All money is testnet money (tUSD, tEUR on Base Sepolia). There is no production deployment.

## Will we keep building after Mumbai?

Not decided yet; the team has not committed either way, and we would rather say so than promise. What would make it worth continuing is known: one real market (a fish auction or a mandi) willing to try staged payouts, a regulated off-ramp per country (stablecoin rules differ, and an India launch would need rupee rails through partners), and agent wallets funded on Arkiv so each seller and buyer owns its own entities. The Arkiv record is the part most worth keeping either way: `price` and `reputation` can be extended by anyone (`permissionlessExtension`), so the history outlives this repo if someone wants it to.
