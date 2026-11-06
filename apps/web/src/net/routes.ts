import {
  AdviceResponse,
  AgentView,
  BidResponse,
  CalendarResponse,
  ConfirmRequest,
  ConfirmResponse,
  CreateBuyerRequest,
  CreateBuyerResponse,
  DirectorScenarioRequest,
  DirectorScenarioResponse,
  DirectorStatus,
  DisputeEvidence,
  DisputeRequest,
  DisputeResponse,
  DraftRequest,
  FxResponse,
  HandoverConfirmRequest,
  HandoverConfirmResponse,
  HandoverTicketRequest,
  HandoverTicketResponse,
  HealthResponse,
  LotDraft,
  LotView,
  NoShowContestRequest,
  NoShowReportRequest,
  NoShowReportResponse,
  PatchAgentRequest,
  ReferenceResponse,
  SellerProfile,
  SttRequest,
  SttResponse,
  TimelineResponse,
  WalkinBidRequest,
  WalkinRequest,
  WalkinResponse,
} from "@fairtown/shared/api"
import { z } from "zod"

export type Method = "get" | "post" | "patch"
/** `auth: "seller"` routes carry the seller session as `Authorization: Bearer` (ICR-009). */
export type Route = { method: Method; path: string; req?: z.ZodType; res: z.ZodType; auth?: "seller" }

// ICR-009: no shared schema for seller sessions yet, so these two are local (see NOTES.md).
export const SellerSessionRequest = z.object({ sellerId: z.string().min(1), pin: z.string().min(1) })
export const SellerSessionResponse = z.object({ token: z.string().min(1), sellerId: z.string(), expiresAt: z.string() })

/**
 * Contract 11, one entry per route. The shared package has no schema for the agents list or lot
 * metadata yet, so those two are local (see NOTES.md).
 */
export const API_ROUTES = {
  health: { method: "get", path: "/api/health", res: HealthResponse },
  draftListing: { method: "post", path: "/api/listings/draft", req: DraftRequest, res: LotDraft },
  confirmListing: { method: "post", path: "/api/listings/confirm", req: ConfirmRequest, res: ConfirmResponse },
  lotMeta: { method: "get", path: "/api/lots/meta/:draftId", res: z.unknown() },
  lot: { method: "get", path: "/api/lots/:lotId", res: LotView },
  lotTimeline: { method: "get", path: "/api/lots/:lotId/timeline", res: TimelineResponse },
  seller: { method: "get", path: "/api/sellers/:sellerId", res: SellerProfile },
  sellerAdvice: { method: "get", path: "/api/sellers/:sellerId/advice", res: AdviceResponse },
  createBuyer: { method: "post", path: "/api/buyers", req: CreateBuyerRequest, res: CreateBuyerResponse },
  agents: { method: "get", path: "/api/agents", res: z.array(AgentView) },
  agent: { method: "get", path: "/api/agents/:agentId", res: AgentView },
  patchAgent: { method: "patch", path: "/api/agents/:agentId", req: PatchAgentRequest, res: AgentView },
  walkin: { method: "post", path: "/api/walkin", req: WalkinRequest, res: WalkinResponse },
  walkinBid: { method: "post", path: "/api/walkin/bid", req: WalkinBidRequest, res: BidResponse },
  sellerSession: { method: "post", path: "/api/sessions/seller", req: SellerSessionRequest, res: SellerSessionResponse },
  handoverTicket: {
    method: "post",
    path: "/api/handover/ticket",
    req: HandoverTicketRequest,
    res: HandoverTicketResponse,
    auth: "seller",
  },
  handoverConfirm: {
    method: "post",
    path: "/api/handover/confirm",
    req: HandoverConfirmRequest,
    res: HandoverConfirmResponse,
  },
  noshowReport: { method: "post", path: "/api/noshow/report", req: NoShowReportRequest, res: NoShowReportResponse },
  noshowContest: { method: "post", path: "/api/noshow/contest", req: NoShowContestRequest, res: DisputeResponse, auth: "seller" },
  openDispute: { method: "post", path: "/api/disputes", req: DisputeRequest, res: DisputeResponse },
  disputeEvidence: { method: "get", path: "/api/disputes/:disputeId/evidence", res: DisputeEvidence },
  stt: { method: "post", path: "/api/stt", req: SttRequest, res: SttResponse },
  reference: { method: "get", path: "/api/reference", res: ReferenceResponse },
  calendar: { method: "get", path: "/api/calendar", res: CalendarResponse },
  fx: { method: "get", path: "/api/fx", res: FxResponse },
  directorScenario: {
    method: "post",
    path: "/api/director/scenario",
    req: DirectorScenarioRequest,
    res: DirectorScenarioResponse,
  },
  directorStatus: { method: "get", path: "/api/director/status", res: DirectorStatus },
} as const satisfies Record<string, Route>

export type ApiRoutes = typeof API_ROUTES
export type RouteKey = keyof ApiRoutes
