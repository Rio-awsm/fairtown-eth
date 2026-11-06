import type { Grade, Sector } from "@fairtown/shared"
import { z } from "zod"
import type { AiGateway } from "../ai/gateway"
import type { AiTrace } from "../ai/providers"
import { verificationOf } from "../ai/verification"
import { GRADES_FOR, RUBRIC } from "./catalog"
import type { StoredPhoto } from "./photos"

export type GradeReport = { grade: Grade; defects: string[]; confidence: number; lotCodeVisible?: boolean; untrusted?: boolean }
export type GradeResult = { report: GradeReport; trace?: AiTrace; source: "vision" | "fixed" | "unavailable" }

const schemaFor = (sector: Sector) =>
  z.object({
    grade: z.enum(GRADES_FOR[sector] as [Grade, ...Grade[]]),
    defects: z.array(z.string().max(80)).max(6),
    confidence: z.number().min(0).max(1),
    lotCodeVisible: z.boolean().describe("true if the 4-digit lot code is readable in at least one photo"),
  })

// AI opinion, shown as one. Never blocks a listing: if vision fails, the grade is "na".
export async function gradeLot(
  sector: Sector,
  commodity: string,
  photos: StoredPhoto[],
  ai: Pick<AiGateway, "decide">,
): Promise<GradeResult> {
  if (sector === "compute") return { report: { grade: "gpu_verified", defects: [], confidence: 1 }, source: "fixed" }
  if (sector === "truck" || sector === "storage") return { report: { grade: "na", defects: [], confidence: 1 }, source: "fixed" }
  if (!photos.length) return { report: { grade: "na", defects: ["No photos"], confidence: 0 }, source: "unavailable" }
  try {
    const r = await ai.decide("vision", {
      system: `You grade ${commodity} from photos for a public market. Rubric: ${RUBRIC[sector]} Be strict and list visible defects briefly.`,
      prompt: `Grade this lot of ${commodity}. The seller's lot code is ${photos[0]!.lotCode}; say whether it is readable in a photo.`,
      images: photos.map((p) => ({ data: p.dataUrl })),
      schema: schemaFor(sector),
      timeoutMs: 15_000,
    })
    const report: GradeReport = { ...r.value }
    if (!r.value.lotCodeVisible) report.defects = [...report.defects, "Lot code not visible"]
    // tee_verified false: the provider's TEE signature did not check out, so the grade is flagged and can't lift the floor.
    if (!verificationOf(r.trace).trusted) {
      report.untrusted = true
      report.defects = [...report.defects, "Grade not attested: TEE check failed"]
    }
    return { report, ...(r.trace ? { trace: r.trace } : {}), source: "vision" }
  } catch {
    return { report: { grade: "na", defects: ["Grading unavailable"], confidence: 0 }, source: "unavailable" }
  }
}
