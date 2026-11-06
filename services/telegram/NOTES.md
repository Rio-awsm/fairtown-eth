# Telegram bot (TG stream) notes

Sellers, buyers and drivers run Fairtown from a Telegram chat. Off by default (`ADDON_TELEGRAM=0`, D-122).

## Rules this service keeps

- Thin client. It holds no keys and never talks to the chain. Every action goes through the agents service (:8787),
  so every bid still passes the runtime guardrails. Notifications come from the relay (:8788).
- Private chats only; the bot leaves any group (handover codes and sessions must not land in a group).
- Money typed by users is parsed with `toBase()` into bigint base units. Never a JS number.
- Anything that moves money gets a confirm button. Buttons expire and are bound to the user they were sent to.
- The token is in every Bot API URL. All log lines go through `redact()`; user message text is never logged.
- A QR handover ticket is never forwarded from one Telegram user to another: the scan proves the meeting.

## Steps

| Step | What |
| --- | --- |
| TG 0.1 | Scaffold, config, /start and /help, test harness, doctor rows |
| TG 0.2 | Agents-service prerequisites (ICR-012, proposed): bot service token, per-user rate limits, owner checks. Seller registration and STT mime type moved to later steps (D-124) |
| TG 1.1 | Identity and linking: role menu, `/link` with seller id + PIN, walk-in buyers, session refresh |
| TG 1.2 | Seller listing: text, voice, photos with a 4-digit lot code, draft card, confirm |
| TG 1.3 | `/lots`, `/profile`, `/advice` |
| TG 2.1 | Relay notifications |
| TG 2.2 | Buyer: `/market`, `/lot`, `/bid` with confirm, optional mandate agent |
| TG 3.1 | QR handover: issue as QR image, receive by photo decode |
| TG 3.2 | Drivers: capacity, carrier assigned, pickup and drop-off |
| TG 3.3 | No-show report and contest, disputes |
| TG 4.1 | Webhook mode, Mini App scanner, `e2e:telegram` |

Hackathon cut (before the Sat 01:00 freeze): 0.1, 0.2 (rate limits and ownership only), 1.1, 1.2, 2.1, 2.2, 3.1.

## Found while planning (agents service, S2 folders; fix in TG 0.2 through an ICR)

1. PIN and walk-in rate limits key on `req.ip` (`handover/routes.ts`, `humans/routes.ts`). All bot traffic shares one IP:
   one wrong PIN locks every bot user out, and walk-ins cap at 3 per 10 minutes for the whole bot.
2. `POST /api/listings/confirm` has no seller-session check; `PATCH /api/agents/:id` has no auth at all.
3. Sellers come only from fixture personas (`sellers.ts`); there is no route to register a new seller or driver.
4. STT posts every clip as `audio/webm` (`ai/stt.ts`); Telegram voice notes are OGG/Opus.

## TG 0.1

- grammY 1.46.0 (latest on npm, 2026-11-06), long polling. Docs via Context7 (`/websites/grammy_dev`): pass `botInfo`
  to skip `getMe`; `bot.handleUpdate` rethrows as `BotError`, and only `bot.start()` routes it to `bot.catch`, so the test
  harness calls `bot.errorHandler` itself to match production.
- Tests never reach Telegram: `bot.api.config.use` answers every call. The fake token in `test/harness.ts` is shape-only.
- Doctor rows `tg-config`, `tg-telegram` (getMe; neither the URL nor fetch errors are printed), `tg-services`.
  New doctor owner `TG` in `scripts/doctor/core.ts`.
- `pnpm -F @fairtown/scripts typecheck` reports two errors in `services/agents/src/arkiv/LiveArkivStore.ts` that are
  already on `main` (file untouched here).

## TG 0.2 (ICR-012, proposed, awaiting S2 ack)

- `services/agents/src/callers.ts`: an `onRequest` hook sets `req.caller`. Bot calls send `x-fairtown-bot` (the shared
  `TELEGRAM_SERVICE_TOKEN`, compared in constant time) and `x-telegram-user`; the user header alone is ignored. The token
  header is redacted in request logs. Its own `CallerError` avoids an import cycle with `listing/routes`.
- Rate keys `tg:<id>` or `ip:<ip>`: PIN tries and walk-in joins. The global walk-in cap (`WALKIN_CAP`) still counts everyone.
- `owner: tg:<id>` on runtime agents (walk-in, `/api/buyers`) and drafts made through the bot. Checked on PATCH agent,
  walk-in bid, no-show report, disputes, handover confirm (receiver) and listing confirm. Never returned in a response
  (views pick fields one by one).
- Bot drafts need the seller's PIN session; `sessions` moved earlier in `index.ts` and is passed to the listing routes.
- Mutation check: with `assertOwner` a no-op, 5 of the 15 new tests fail; with PIN tries keyed by `req.ip` again, 1 fails.
- Left for S2 (not changed, would break S3 and e2e): web `POST /api/listings/confirm` and `PATCH /api/agents/:id` still
  need no session for unowned resources; `/api/buyers` mints up to 50,000 per call with no rate limit.
- eslint reports 4 errors in agents files this step did not change lines of (`ens/client.ts`, `bidderEval.ts`,
  `humans/routes.ts:31` cleanName regex, `strategies/llm.ts`).

## TG 1.1 identity and linking

- `/start` offers I sell / I buy / I drive. Sellers and drivers: `/link <id>`, then the PIN as the next plain message.
  The PIN wait lasts 2 minutes, is used once (a wrong PIN ends it), survives other commands, ends with `/cancel`, and
  only that user's messages count. The bot deletes the PIN message first; if Telegram refuses, it asks the user to.
  Role comes from the account (`GET /api/sellers/:id` then `GET /api/agents/:address`), not from the button pressed.
- Buyers: `join:USD|EUR` makes a walk-in. One join at a time per user (`Links.exclusive`), so a double tap is one wallet.
  The agents service doesn't return the walk-in session's end, so the bot ends it at 119 minutes (agents: 120).
- Sessions and links are in memory only; tokens never touch disk. After a bot or agents restart users sign in again.
  The PIN can't be stored to renew a session, so an ended session means `/link` again (the link remembers the id).
- One identity per chat: `/logout` before switching. Re-linking the same seller renews the session.
- `src/agents.ts`: every call sends `x-fairtown-bot` + `x-telegram-user` (ICR-012), 15 s timeout, replies checked with
  the shared schemas, errors carry only status and code. The logger now scrubs the service token too.
- `src/money.ts` formats base units exactly (bigint, no viem dependency needed in the bot).
- Mutation check: skipping the PIN delete fails 2 tests; removing the double-tap lock fails 1.
- Contract check (scratch, not committed): the real client against the real agents routes in-process on FakeChain:
  session, seller profile, roles SELLER and TRUCK, walk-in budget 500000000, and codes `bad_pin`, `unknown_seller`,
  `bad_service_token`, `bad_currency` all as the bot expects.

## TG 1.2 selling from the chat

- `/sell` (sellers, drivers, cold stores with a live session) gives a 4-digit lot code. Up to 3 photos with the code in
  view (largest size under 3 MB, downloaded through the Bot API file endpoint; the URL holds the token and never reaches
  an error or a log), then one message describing the lot. A captioned single photo drafts at once; an album with a
  caption waits for a "Make draft" tap so every photo of the album is in. One answer per album.
- `capturedAt` is when Telegram received the photo: the bot can't see the camera's own time (Telegram strips EXIF).
- The draft card shows grade, checks, reference, floor and the payout if it sells at the floor, after the 1% fee, all in
  bigint (`splitPayout` from shared, as the web app). Buttons carry the draft id and act only on the current draft.
- No real suggestion (reference and recent clears missing, so the agents service falls back to 0.001): no "List"
  button until the seller sets a floor, and a forged "List" press is refused. Found by the contract check.
- Confirm with no answer (timeout, connection lost): the lot may exist on chain, so the bot closes the draft and says
  it can't tell, instead of offering "List" again. A refusal (e.g. a revert) re-offers the card.
- The listing lapses after 15 quiet minutes: no lot, no money. `/cancel` and `/logout` end it too.
- Voice notes: the bot asks for text. STT still posts every clip as `audio/webm` and Telegram voice is OGG (D-123).
- Auction length `TELEGRAM_AUCTION_BLOCKS`, default 150 like the web app. The bot says "150 blocks", not minutes.
- Draft and confirm calls wait up to 60 s (grading; the lot on chain); other calls 15 s.
- Mutation check: buttons acting on any draft id fails 1 test; re-offering List after a timeout fails 1; dropping the
  placeholder guard fails 1. Album test caught a real bug (a second, contradictory reply after a captioned album photo).
- Contract check (scratch): draft shape, `no_session`, `unreadable`, `not_your_draft` for another Telegram user, lot
  created on FakeChain for the right seller at the chosen floor and qty, then `already_listed`.
- For S2 (not changed): `/api/listings/confirm` checks `d.confirmed` before the chain call and sets it after, so two
  confirms in flight at once could both create a lot. The bot sends one at a time per user, but the web app doesn't.

## TG 1.3, 2.1, 2.2, 3.1, 3.2, 3.3

- 2.1 `src/relay.ts`: Node 22's global WebSocket to the relay (no `ws` dependency). Every envelope zod-checked, dedupe
  by id (bounded), snapshot on each connect (its `recent` are marked seen, so no stale notifications), reconnect with
  backoff 2 s to 30 s. Missed events during a drop are not replayed. A handler that throws is logged; found by a test
  that a synchronous throw escaped `Promise.resolve(...)` and would have ended the process.
- 2.1 `src/notify.ts`: sellers hear bids (once a minute per lot, with a count), sale with exact paid/held/fee and
  pickup deadline, relist, truck booked, handover, delivered, paid in full, no-show report, refund, disputes, ruling,
  record. Bidders hear outbid (once per crossing, re-armed by a new bid) and how to collect. Drivers hear transport
  needed (once a minute) and bookings. One send at a time; 429 waits `retry_after` once; 403 forgets the link.
- 2.2 `src/buy.ts`: `/market` (open lots from the relay), `/lot N` (agents service + timeline), `/bid N`: price and
  total as one message, confirm card, `POST /api/walkin/bid`. Bot checks: walk-in with a live visit, lot open, lot
  currency = walk-in currency. Guardrails decide the rest. Card lapses after 5 minutes. A failed or unanswered bid is
  never retried. The guardrails clamp an oversized amount to budget and the 60% cap (contract check: a 999,000 EUR
  bid from a 500 EUR walk-in was placed, smaller); the route returns only `{ bidId, tx }`, so the bot says the amount
  may have been lowered rather than claiming a number. For S2: return the placed `amount`/`maxPerUnit`/`clamped`.
- 3.1 / 3.2 `src/handover.ts`: `/qr N` (seller, or a driver for a truck lot): checks the lot is theirs, picks the
  holder from `winners` (buttons when several), gets the signed ticket, sends a QR PNG (`qrcode`, loaded lazily; the
  bot still works without it), the web scan link, and a 6-digit code. `/receive CODE` (walk-in or driver): 5 tries per
  10 minutes, code single-use, expires with the ticket (~5 min). The code is shown in person like the QR; the contract
  releases money only to the buyer or assigned carrier named in the ticket. AI (persona) buyers are confirmed through
  the web scan page, as before.
- 3.3 `src/trust.ts`: `/noshow N` (button first), `/dispute N` and `/contest N` with 1 to 3 photos and a lot code.
  The reporter for a contest comes from the relay's `noshow.reported`. Unanswered filings close and say so.
- 1.3 `src/account.ts`: `/lots` (seller: every lot in town with their address, newest first; buyer: lots bid on from
  the chat), `/profile` (seller record and payouts summed in bigint; buyer budget), `/advice`.
- One flow per user: `/sell`, `/bid`, `/noshow`, `/dispute`, `/contest` end any other flow first, so photos and numbers
  go to the flow that asked. `/cancel` and `/logout` end all of them.
- Mutation checks: dropping the `/qr` ownership check, single-use codes, the guess limit, or the no-retry rule for
  bids each fails a test.
- Contract check (scratch, real agents routes on FakeChain + real relay over a real WebSocket): sold lot with 2
  winners, ticket, handover released 403.326 EUR, ticket reuse refused (`TicketUsed`), timeline to Delivered, walk-in
  bid placed, `not_your_agent` for another Telegram user, relay snapshot parsed and a live event received.
- Not done (TG 4.1): webhook mode, the Mini App scanner, decoding a QR from a photo, an `e2e:telegram` script, voice.

## Simpler selling (after the first live test)

- A signed-in seller or driver sends a photo with the description as its caption, and gets the draft card back. No /sell, no lot code to write down. /sell is kept for text-only listings.
- One tap on List is still needed: it is the seller's check on the AI's reading of quantity and floor before anything reaches the chain. The 0.001 placeholder floor still can't be listed.
- Albums: drafted once, 2 s after the last photo arrives (ALBUM_WAIT_MS), from the album's caption. The "Make draft" button is gone.
- A new captioned photo while a card is open starts a fresh listing; the old card's buttons expire.
- Photos sent during a bid, /dispute, /contest or /noshow go to that flow, never to a listing.
- The photos still carry a generated lot code (DraftRequest needs one), so the grader's "Lot code not visible" check is hidden on the card.
