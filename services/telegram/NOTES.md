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
| TG 0.2 | Agents-service prerequisites (S2 sign-off + ICR): bot service token, per-user rate limits, ownership checks on confirm and PATCH, seller registration, STT mime type |
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
