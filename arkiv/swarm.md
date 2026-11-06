# Swarm and Arkiv

Lot photos are stored on **Swarm** (mainnet); the **Arkiv** `lot` entity holds each photo's SHA-256 hash and its plain Swarm reference. Arkiv is the public, queryable record of the market; Swarm holds the bytes, which are too large for Arkiv (100 KiB payload cap) and don't need indexing. Behind `ADDON_SWARM=1`.

## What lives where

| Data | Where | Why |
|---|---|---|
| Lot photo bytes | Swarm, uploaded unencrypted through our Bee node; also on the agents service's disk (primary copy) | Product photos (fish, tomatoes, flowers), no personal data, so anyone can check them |
| Photo SHA-256 hash and Swarm reference | Arkiv `lot` entity, `details` (bytes JSON): `details.photos` (hashes) and `details.swarm` = `[{ "hash": "0x...", "ref": "<64 hex>" }]` | Public proof of which photo was graded, and where to fetch it |
| Lot facts (commodity, grade, status, floor ...) | Arkiv `lot` entity, indexed columns | Queried by market, status, commodity (see `schema.md`) |

**Encrypted references never go on Arkiv.** An encrypted Swarm reference is 128 hex characters and contains its decryption key. Our uploads are unencrypted, and `SwarmStore.upload` rejects anything that is not a plain 64-hex reference (`services/agents/src/addons/swarm/store.ts`, `isPlainRef`), so a key can't reach a public entity even by mistake.

## One entity and its reference

| | |
|---|---|
| Arkiv entity key (`fairtown.v1.lot`) | `0x86e0f000e218b880e15c98601d973914f11a3a1bec6f9e16be395220630332a1` ([explorer](https://rabdi.explorer.arkiv.network/entity/0x86e0f000e218b880e15c98601d973914f11a3a1bec6f9e16be395220630332a1)) |
| Swarm reference in its `details.swarm[0].ref` | `a7337bff060ca8052b299752151d1f453bda67dd5fcc7a71488873332d41cd68` |
| Read it | https://bzz.limo/bzz/a7337bff060ca8052b299752151d1f453bda67dd5fcc7a71488873332d41cd68/ |

This entity was written by `pnpm -F agents swarm:check` and is labelled in its details as a Swarm proof lot (not a real sale). Lots listed with `ADDON_SWARM=1` get the same `details.swarm` field through the normal ledger writer.

## Postage batch, wallet and node

| | |
|---|---|
| Postage batch ID | `426f447f5973f085b47dbb62a348dba883afa98d547ad50150a8e04920f6fef6` (depth 17, about 27 days from 2026-11-06, cost 1.25 xBZZ) |
| Bought by | our Bee node's wallet `0x4c8Bf00b3D382b723dB58372048c00D4E5981BB4` (Gnosis Chain) |
| Funded by | the Swarm booth's gift wallet at ETHGlobal Mumbai / Devcon 8 (`0x9Af72792fad63839E4713463ab2FdcD09e9Fd261`): 10 xBZZ ([tx](https://gnosisscan.io/tx/0x8790242196cef831e87376b63626043567ea6a9e25262cde595465ead77c709f)) and xDAI ([tx](https://gnosisscan.io/tx/0xc4731db34041751850c9c0d50c0edfb038e59672a076f564ac168727f7fbc132)) |
| Node used for upload | our own Bee **2.8.3** light node, mainnet (`full-node: false`, `swap-enable: true`, RPC `https://xdai.fairdatasociety.org`), API on `127.0.0.1:1633` only |
| Read gateway | https://bzz.limo (public, no node needed) |

## Files that upload and read

| File | What it does |
|---|---|
| `services/agents/src/addons/swarm/store.ts` | `SwarmStore`: `upload` (`POST /bzz` with `Swarm-Postage-Batch-Id`), `read` (`GET /bzz/<ref>/`), `health` (`GET /stamps/<batch>`), gateway links |
| `services/agents/src/listing/routes.ts` | uploads listing photos while the grader runs; shows `photos[].swarm` in lot metadata; `/api/photos/:hash` reads from Swarm if the local file is gone |
| `services/agents/src/index.ts` | puts `details.swarm` on the Arkiv `lot` entity |
| `services/agents/scripts/swarm-fund.ts` | one-time: gift wallet to node wallet, waits for the chequebook, buys the batch, writes `SWARM_BATCH_ID` |
| `services/agents/scripts/bee-start.sh` | starts the node with `~/.fairtown/bee.yaml` |
| `services/agents/scripts/swarm-check.ts` | one upload, two reads, one Arkiv entity (below) |
| `services/agents/test/swarm.test.ts` | upload and read, encrypted-reference refusal, health, listing with Swarm and with the node down |

## Run one upload and one read

Requirements: Node 22, pnpm 9, a running Bee node with a usable batch (`SWARM_BEE_URL`, `SWARM_BATCH_ID` in `.env`), and for the Arkiv step `ARKIV_ACCESS_KEY` and `ARKIV_PRIVATE_KEY`.

```bash
pnpm -F agents swarm:node                 # in its own terminal: starts Bee
pnpm -F agents swarm:check [photo.jpg]    # uploads, reads back, writes the Arkiv entity
```

Expected output (2026-11-06 run, default 1x1 PNG):

```
Node: {"ok":true,"detail":"batch usable, about 27 days left, 0 uploaded, 0 failed"}
Uploaded 70 bytes in 6 ms: reference a7337bff060ca8052b299752151d1f453bda67dd5fcc7a71488873332d41cd68
Read from our node: 70 bytes, sha256 matches
Read from https://bzz.limo/bzz/a7337bff.../: HTTP 200
Arkiv lot entity 0x86e0f000... (lotId 1793952308512) holds Swarm reference a7337bff...
```

Anyone can do the read without our node: open the bzz.limo link above, or `curl -sI https://bzz.limo/bzz/<ref>/`.

## If Swarm can't be deployed

The local disk stays the primary copy. If the Bee node is down, slow (20 s cap) or the batch expires, listings go on with local photos, the lot simply has no `details.swarm`, and `/api/health` shows `swarm` as degraded (`services/agents/test/swarm.test.ts`, "lists normally on local photos when the Bee node is down").

## Demo video

Swarm appears at: **TODO (team): timestamp in the final video**.

## Problems we hit

- **Homebrew formula broken.** `brew install swarm-bee` (tap `ethersphere/tap`, formula 2.8.3) fails on current Homebrew with `NoMethodError: undefined method 'exists?' for class File` (Ruby removed `File.exists?`). We used the release binary `bee-darwin-arm64.tar.gz` from GitHub v2.8.3 and checked it against `bee_2.8.3_checksums.txt` (sha256 `a62456f5...ead09`).
- **Node exits if it isn't funded in time.** A fresh light node waits for xDAI to deploy its chequebook, then shuts down with `init chequebook service: chequebook init: insufficient xDAI for deploying chequebook`. Its wallet is kept in the data dir, so funding first and restarting works; our funding script takes the node address from `.env` so it can run while the node is stopped.
- **Gift code is a raw private key.** Convenient, but easy to paste into a chat; we kept it only in `.env` and moved the funds to the node's own wallet once.
