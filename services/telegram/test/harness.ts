import type { Bot } from "grammy"
import type { Chat, Message, Update, User, UserFromGetMe } from "grammy/types"
import {
  AgentsError,
  type AgentInfo,
  type AgentsClient,
  type ConfirmBody,
  type Confirmed,
  type DraftBody,
  type DraftView,
  type LotInfo,
  type PhotoBody,
  type SellerInfo,
  type SellerProfile,
  type Ticket,
  type Timeline,
  type SellerSession,
  type Walkin,
} from "../src/agents"
import { FileError, type Files } from "../src/files"
import { buildBot, type BotDeps } from "../src/bot"
import { Codes } from "../src/handover"
import { Links } from "../src/links"
import { Market } from "../src/market"
import type { Level, Log } from "../src/log"

// Not a real token: the right shape for the config check, nothing more. Every API call below is intercepted.
export const FAKE_TOKEN = "123456:TEST-ONLY-fake-token-not-real-0000000"

export const BOT_INFO = {
  id: 123456,
  is_bot: true,
  first_name: "Fairtown Test",
  username: "fairtown_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe

export const ALICE: User = { id: 1001, is_bot: false, first_name: "Alice" }
export const MALLORY: User = { id: 6666, is_bot: false, first_name: "Mallory" }

export type Call = { method: string; payload: Record<string, unknown> }

// Fake agents service: the demo personas, PIN "4821", walk-ins with 500 test money. Every call is recorded.
export const PIN = "4821"
export const T0 = 1_793_000_000_000
const SELLERS: Record<string, { name: string; role: string; address: string }> = {
  ingrid: { name: "Ingrid Solheim", role: "SELLER", address: "0x00000000000000000000000000000000000000a1" },
  lars: { name: "Lars", role: "TRUCK", address: "0x00000000000000000000000000000000000000b2" },
}
export type AgentsCall = { fn: keyof AgentsClient; user: number; args: unknown[] }

// What the agents service drafts from "600 kg cod, Bergen": 7.50 EUR/kg suggested, new seller (50% at the sale).
export const COD_DRAFT: DraftView = {
  draftId: "d_0000000000c1",
  sector: "fish",
  commodity: "cod",
  qty: "600",
  unit: "kg",
  place: "bergen",
  market: "fish_dock",
  currency: "EUR",
  grade: "class_1",
  gradeReport: { grade: "class_1", defects: [], confidence: 0.8 },
  suggestedFloorPerUnit: "7500000",
  payoutPreview: { advanceBps: 5000, tier: "new" },
  floorBasis: ["Reference 8.10 EUR/kg", "Grade class 1"],
}
export const TX = `0x${"ab".repeat(32)}`
export const INGRID = "0x00000000000000000000000000000000000000a1"
export const LARS = "0x00000000000000000000000000000000000000b2"
export const WALKIN_1 = `0x${"1".padStart(40, "c")}` // the first walk-in the fake makes
export const OTHER_BUYER = "0x00000000000000000000000000000000000000d4"
export const TICKET = { lotId: "12", buyer: WALKIN_1, tokenAmount: "600000000000000000000", expiryBlock: "2000", sig: `0x${"11".repeat(65)}` }

// Lot 12: Ingrid's 600 kg cod, sold at 8.40 EUR, one walk-in holding all 600 units.
export const SOLD_LOT: LotInfo = {
  lotId: "12",
  status: "sold",
  spec: { seller: INGRID, commodity: "cod", qty: "600", floorPerUnit: "7500000", currency: "EUR", place: "bergen", market: "fish_dock", sector: "fish" },
  clearing: "8400000",
  endBlock: "46",
  bidCount: 5,
  settlement: { finalClearingPerUnit: "8400000", soldUnits: "600", sellerPaid: "2494800000", held: "2494800000", heldRemaining: "2494800000", fee: "50400000", pickupDeadline: "346", advanceBps: 5000 },
  winners: [{ buyer: WALKIN_1, tokenAmount: "600000000000000000000" }],
}
export const OPEN_LOT: LotInfo = { ...SOLD_LOT, lotId: "13", status: "open", clearing: "0", settlement: undefined, winners: undefined } as LotInfo

export class FakeFiles implements Files {
  fetched: string[] = []
  fail?: FileError
  async photo(fileId: string) {
    this.fetched.push(fileId)
    if (this.fail) throw this.fail
    return Buffer.from(`jpeg-bytes-of-${fileId}`)
  }
}
export class FakeAgents implements AgentsClient {
  calls: AgentsCall[] = []
  fail: Partial<Record<keyof AgentsClient, Error>> = {}
  walkinGate?: Promise<void>
  confirmGate?: Promise<void>
  draftResult: DraftView = COD_DRAFT
  lots = new Map<string, LotInfo>([
    ["12", SOLD_LOT],
    ["13", OPEN_LOT],
  ])
  payouts: NonNullable<SellerProfile["payouts"]> = []
  private walkins = 0
  private listed = 0
  constructor(private readonly now: () => number) {}
  private record(fn: keyof AgentsClient, user: number, ...args: unknown[]) {
    this.calls.push({ fn, user, args })
    const e = this.fail[fn]
    if (e) throw e
  }
  async sellerSession(user: number, sellerId: string, pin: string): Promise<SellerSession> {
    this.record("sellerSession", user, sellerId, pin)
    if (!SELLERS[sellerId]) throw new AgentsError(404, "unknown_seller", `No seller ${sellerId}`)
    if (pin !== PIN) throw new AgentsError(401, "bad_pin", "Wrong PIN")
    return { token: `seller-session-${sellerId}-${user}`, sellerId, expiresAt: new Date(this.now() + 2 * 3600_000).toISOString() }
  }
  async seller(user: number, sellerId: string): Promise<SellerInfo> {
    this.record("seller", user, sellerId)
    const s = SELLERS[sellerId]!
    return { sellerId, name: s.name, address: s.address }
  }
  async agent(user: number, agentId: string): Promise<AgentInfo> {
    this.record("agent", user, agentId)
    const s = Object.values(SELLERS).find((x) => x.address === agentId)
    return s ? { agentId, name: s.name, role: s.role as AgentInfo["role"] } : { agentId, name: "walk-in", role: "HUMAN", budget: "500000000" }
  }
  async walkin(user: number, name: string, currency: "USD" | "EUR"): Promise<Walkin> {
    this.record("walkin", user, name, currency)
    if (this.walkinGate) await this.walkinGate
    const n = ++this.walkins
    return { agentId: `0x${n.toString(16).padStart(40, "c")}`, address: `0x${n.toString(16).padStart(40, "c")}`, token: `walkin-session-${n}` }
  }
  async draft(user: number, session: string, body: DraftBody): Promise<DraftView> {
    this.record("draft", user, session, body)
    return this.draftResult
  }
  async confirm(user: number, body: ConfirmBody): Promise<Confirmed> {
    this.record("confirm", user, body)
    if (this.confirmGate) await this.confirmGate
    const lotId = String(++this.listed + 11)
    return { lotId, auction: `0x${"a".repeat(40)}`, token: `0x${"b".repeat(40)}`, tx: TX }
  }
  async sellerProfile(user: number, sellerId: string): Promise<SellerProfile> {
    this.record("sellerProfile", user, sellerId)
    const s = SELLERS[sellerId]!
    return { sellerId, name: s.name, address: s.address, tier: "new", record: { cleanLots: 2, noShows: 0, proven: false }, lots: [], payouts: this.payouts }
  }
  async advice(user: number, sellerId: string) {
    this.record("advice", user, sellerId)
    return { advice: "Cod in Bergen cleared at 8.40 EUR today. A floor near 7.50 sells quickly.", basis: {} }
  }
  async lot(user: number, lotId: string): Promise<LotInfo> {
    this.record("lot", user, lotId)
    const l = this.lots.get(lotId)
    if (!l) throw new AgentsError(404, "unknown_lot", `No lot ${lotId}`)
    return l
  }
  async timeline(user: number, lotId: string): Promise<Timeline> {
    this.record("timeline", user, lotId)
    return { steps: [{ name: "Listed", status: "done" }, { name: "Sold", status: "done" }, { name: "Picked up", status: "current" }] }
  }
  async bid(user: number, body: { token: string; lotId: string; maxPerUnit: string; amount: string }) {
    this.record("bid", user, body)
    return { bidId: "7", tx: TX }
  }
  async ticket(user: number, session: string, body: { sellerId: string; lotId: string; buyer: string; tokenAmount: string }): Promise<Ticket> {
    this.record("ticket", user, session, body)
    return { ticket: { ...TICKET, lotId: body.lotId, buyer: body.buyer, tokenAmount: body.tokenAmount }, qrText: "FT1.ticket-text", fallbackUrl: "https://town.example/scan#t=abc" }
  }
  async confirmHandover(user: number, body: { receiverId: string; ticket: typeof TICKET }) {
    this.record("confirmHandover", user, body)
    return { tx: TX, releasedToSeller: "2494800000" }
  }
  async reportNoShow(user: number, body: { buyerId: string; lotId: string; tokenAmount: string }) {
    this.record("reportNoShow", user, body)
    return { tx: TX, contestEnds: 900 }
  }
  async contestNoShow(user: number, session: string, body: { sellerId: string; lotId: string; buyer: string; photos: PhotoBody[] }) {
    this.record("contestNoShow", user, session, body)
    return { disputeId: "3", tx: TX }
  }
  async dispute(user: number, body: { buyerId: string; lotId: string; tokenAmount: string; photos: PhotoBody[] }) {
    this.record("dispute", user, body)
    return { disputeId: "4", tx: TX }
  }
}
export type Entry = { level: Level; msg: string; extra?: Record<string, unknown> }

const privateChat = (u: User): Chat.PrivateChat => ({ id: u.id, type: "private", first_name: u.first_name })
const DATE = 1_793_000_000

export function harness(over: Partial<BotDeps> = {}, fail?: (call: Call) => Error | undefined) {
  let clock = T0
  const now = () => clock
  const agents = new FakeAgents(now)
  const files = new FakeFiles()
  const links = new Links(now)
  const market = new Market()
  const qrs: string[] = []
  const timers: Array<() => void> = []
  // Runs the album timers the bot set, then lets their replies settle.
  const flush = async () => {
    for (const f of timers.splice(0)) f()
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
  }
  let codeN = 0
  const calls: Call[] = []
  const logs: Entry[] = []
  const log: Log = {
    info: (msg, extra) => logs.push({ level: "info", msg, ...(extra ? { extra } : {}) }),
    warn: (msg, extra) => logs.push({ level: "warn", msg, ...(extra ? { extra } : {}) }),
    error: (msg, extra) => logs.push({ level: "error", msg, ...(extra ? { extra } : {}) }),
  }
  const bot: Bot = buildBot({
    token: FAKE_TOKEN,
    botInfo: BOT_INFO,
    log,
    agents,
    links,
    market,
    files,
    lotCode: () => "4821",
    later: (f) => void timers.push(f),
    qr: async (t) => {
      qrs.push(t)
      return Buffer.from("png")
    },
    codes: new Codes(now, () => String(482190 + ++codeN)),
    now,
    ...over,
  })
  bot.api.config.use(async (_prev, method, payload) => {
    const call = { method, payload: (payload ?? {}) as Record<string, unknown> }
    calls.push(call)
    const err = fail?.(call)
    if (err) throw err
    const chatId = Number(call.payload.chat_id ?? 0)
    const result =
      method === "sendMessage"
        ? ({ message_id: calls.length, date: DATE, chat: { id: chatId, type: "private", first_name: "x" }, text: String(call.payload.text) } satisfies Message.TextMessage)
        : true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, result } as any
  })

  let updateId = 1
  // Updates go through bot.handleUpdate; errors are routed to the bot's own handler exactly as bot.start() does.
  const dispatch = async (u: Omit<Update, "update_id">) => {
    const update = { update_id: updateId++, ...u } as Update
    await bot.handleUpdate(update).catch((e: unknown) => bot.errorHandler(e as Parameters<Bot["errorHandler"]>[0]))
  }
  const text = (t: string, from: User = ALICE, chat: Chat = privateChat(from)) => {
    const cmd = t.match(/^\/\w+/)
    return dispatch({
      message: {
        message_id: updateId,
        date: DATE,
        chat,
        from,
        text: t,
        ...(cmd ? { entities: [{ type: "bot_command", offset: 0, length: cmd[0].length }] } : {}),
      } as NonNullable<Update["message"]>,
    })
  }
  const press = (data: string, from: User = ALICE) =>
    dispatch({
      callback_query: {
        id: `cb${updateId}`,
        from,
        chat_instance: "ci",
        data,
        message: { message_id: 1, date: DATE, chat: privateChat(from), text: "old" } as Message.TextMessage,
      },
    })
  const sent = () => calls.filter((c) => c.method === "sendMessage")
  const replies = () => sent().map((c) => String(c.payload.text))
  // A photo as Telegram sends it: three sizes of one picture, optional caption and album id.
  const photo = (o: { id?: string; caption?: string; group?: string; from?: User } = {}) => {
    const from = o.from ?? ALICE
    const id = o.id ?? `p${updateId}`
    return dispatch({
      message: {
        message_id: updateId,
        date: DATE,
        chat: privateChat(from),
        from,
        photo: [
          { file_id: `${id}-s`, file_unique_id: `${id}s`, width: 90, height: 67, file_size: 1_000 },
          { file_id: `${id}-l`, file_unique_id: `${id}l`, width: 1280, height: 960, file_size: 200_000 },
          { file_id: `${id}-m`, file_unique_id: `${id}m`, width: 320, height: 240, file_size: 20_000 },
        ],
        ...(o.caption ? { caption: o.caption } : {}),
        ...(o.group ? { media_group_id: o.group } : {}),
      } as NonNullable<Update["message"]>,
    })
  }
  const voice = (from: User = ALICE) =>
    dispatch({
      message: { message_id: updateId, date: DATE, chat: privateChat(from), from, voice: { file_id: "v1", file_unique_id: "v1", duration: 4 } } as NonNullable<Update["message"]>,
    })
  const tick = (ms: number) => (clock += ms)
  return { bot, calls, logs, dispatch, text, press, photo, voice, sent, replies, privateChat, agents, files, links, market, qrs, tick, flush, timers, DATE }
}
