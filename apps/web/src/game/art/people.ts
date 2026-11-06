import type { Role } from "@fairtown/shared/keys"
import type { Facing } from "../agents/facing"
import { P } from "./palette"
import { Pix, hashOf, type Hex } from "./pix"

/** One person frame. A sheet is 4 facings × 3 frames (stand, step, other step) in one row. */
export const PERSON = { w: 16, h: 20, frames: 3 } as const
export const SHEET_FACINGS: readonly Facing[] = ["down", "left", "right", "up"]

const SKIN: readonly Hex[] = ["#f5d0a9", "#e8b48a", "#c68a5a", "#9a6440", "#6b432b"]
const HAIR: readonly Hex[] = ["#2a1f33", "#5a3420", "#a0582a", "#e2b85c", "#9a9aa6", "#b0402c"]
const STYLES = ["short", "long", "bun", "cap"] as const
type Style = (typeof STYLES)[number]

/** Outfit by role: the shirt says what an agent does, at a glance, before any label. */
const OUTFIT: Record<Role, { shirt: Hex; shade: Hex; pants: Hex; extra: Hex }> = {
  NONE: { shirt: "#a3a9b0", shade: "#7c838b", pants: "#4c5666", extra: "#d6d0c6" },
  SELLER: { shirt: "#4f9a4a", shade: "#357035", pants: "#5a3d2b", extra: "#fffaea" },
  BUYER: { shirt: "#3a7bc8", shade: "#285a99", pants: "#3b3350", extra: "#7a4b2a" },
  TRUCK: { shirt: "#e07a2a", shade: "#a8561a", pants: "#3f4a5c", extra: "#ffe08a" },
  STORAGE: { shirt: "#3fa7c4", shade: "#2a7a92", pants: "#3f4a5c", extra: "#e6f6fc" },
  SOCIETY: { shirt: "#8a5cc4", shade: "#663f99", pants: "#4a3a5a", extra: "#f7e08a" },
  HUMAN: { shirt: "#f2b33d", shade: "#c88a1e", pants: "#5a3d2b", extra: "#c6483b" },
}

export type PersonLook = { role: Role; skin: number; hair: number; style: Style }

/** A stable look for an agent: same id, same face, every time. */
export function lookFor(agentId: string, role: Role): PersonLook {
  const h = hashOf(agentId)
  // Drivers wear the cap; nobody else gets it by chance.
  const style = role === "TRUCK" ? "cap" : STYLES[(h >>> 8) % 3]!
  return { role, skin: h % SKIN.length, hair: (h >>> 4) % HAIR.length, style }
}

export const lookKey = (l: PersonLook) => `person:${l.role}:${l.skin}${l.hair}${l.style}`

/** Frame index in a sheet for a facing and a step (0 stand, 1 and 2 walking). */
export const frameOf = (f: Facing, step: 0 | 1 | 2) => SHEET_FACINGS.indexOf(f) * PERSON.frames + step

function paintFrame(p: Pix, ox: number, look: PersonLook, face: Facing, step: 0 | 1 | 2) {
  const o = OUTFIT[look.role]
  const skin = SKIN[look.skin]!
  const hair = HAIR[look.hair]!
  const r = (x: number, y: number, w: number, h: number, c: Hex) => p.rect(ox + x, y, w, h, c)
  const side = face === "left" || face === "right"
  const lift = step === 0 ? 0 : 1

  // Legs and shoes; a step lifts one foot.
  const legs = side ? [6, 9] : [5, 9]
  legs.forEach((x, i) => {
    const up = (step === 1 && i === 0) || (step === 2 && i === 1) ? lift : 0
    r(x, 15, 2, 3 - up, o.pants)
    r(x, 18 - up, 2, 1, P.ink)
  })
  // Body with a darker side, and arms that swing with the step.
  r(4, 10, 8, 6, o.shirt)
  r(face === "left" ? 4 : 10, 10, 2, 6, o.shade)
  r(4, 15, 8, 1, o.shade)
  if (!side) {
    const swing = step === 1 ? -1 : step === 2 ? 1 : 0
    r(3, 11 + swing, 1, 3, o.shirt)
    r(12, 11 - swing, 1, 3, o.shirt)
    p.px(ox + 3, 14 + swing, skin)
    p.px(ox + 12, 14 - swing, skin)
  } else {
    const x = face === "left" ? 7 : 8
    r(x, 11, 1, 3, o.shade)
    p.px(ox + x + (step === 1 ? -1 : step === 2 ? 1 : 0), 14, skin)
  }
  // Role detail on the chest.
  if (face !== "up") {
    if (look.role === "SELLER") r(5, 12, 6, 4, o.extra) // apron
    if (look.role === "TRUCK") r(4, 12, 8, 1, o.extra) // hi-vis stripe
    if (look.role === "BUYER") for (let i = 0; i < 5; i++) p.px(ox + 5 + i, 10 + i, o.extra) // satchel strap
    if (look.role === "HUMAN") {
      // A diamond pin: the walk-in visitor.
      p.px(ox + 7, 11, o.extra)
      p.px(ox + 6, 12, o.extra)
      p.px(ox + 8, 12, o.extra)
      p.px(ox + 7, 13, o.extra)
    }
    if (look.role === "STORAGE") r(4, 10, 8, 1, o.extra) // scarf
    if (look.role === "SOCIETY") p.px(ox + 8, 12, o.extra) // badge
  }

  // Head.
  r(4, 2, 8, 8, skin)
  if (face === "up") r(4, 2, 8, 8, hair)
  else if (face === "down") {
    p.px(ox + 6, 6, P.ink)
    p.px(ox + 9, 6, P.ink)
    p.px(ox + 5, 7, "#f2a0a0")
    p.px(ox + 10, 7, "#f2a0a0")
  } else {
    const eye = face === "left" ? 5 : 10
    p.px(ox + eye, 6, P.ink)
    r(face === "left" ? 8 : 4, 3, 4, 5, hair) // back of the head
  }
  // Hair by style.
  r(4, 1, 8, 3, hair)
  r(3, 2, 1, 3, hair)
  r(12, 2, 1, 3, hair)
  if (look.style === "long" && face !== "up") {
    r(3, 3, 1, 6, hair)
    r(12, 3, 1, 6, hair)
  }
  if (look.style === "long" && face === "up") r(4, 9, 8, 2, hair)
  if (look.style === "bun") r(6, 0, 4, 2, hair)
  if (look.style === "cap") {
    r(3, 1, 10, 3, o.shirt)
    r(4, 1, 8, 1, o.extra)
    if (face === "down") r(4, 4, 8, 1, o.shade)
    if (face === "left") r(1, 3, 4, 1, o.shade)
    if (face === "right") r(11, 3, 4, 1, o.shade)
  }
}

/** The whole sheet for one look: SHEET_FACINGS × PERSON.frames, outlined, with a ground shadow. */
export function paintPerson(look: PersonLook): Pix {
  const sheet = new Pix(PERSON.w * PERSON.frames * SHEET_FACINGS.length, PERSON.h)
  SHEET_FACINGS.forEach((face, f) => {
    for (const step of [0, 1, 2] as const) {
      const frame = new Pix(PERSON.w, PERSON.h)
      paintFrame(frame, 0, look, face, step)
      frame.outline(P.ink)
      const ox = (f * PERSON.frames + step) * PERSON.w
      sheet.rect(ox + 4, 18, 8, 2, P.ink, 60)
      sheet.blit(frame, ox, 0)
    }
  })
  return sheet
}
