import type { Role } from "@fairtown/shared/keys"
import { useMemo } from "react"
import { PERSON, frameOf, lookFor, paintPerson, type PersonLook } from "../game/art/people"
import { runsOf } from "../game/art/runs"

type Props = { look?: PersonLook; id?: string; role?: Role; size?: number; className?: string }

/** The same pixel person the town draws, as a crisp inline SVG. Decorative: always next to a name. */
export function PixelPerson({ look, id = "", role = "NONE", size = 40, className = "" }: Props) {
  const l = look ?? lookFor(id, role)
  const runs = useMemo(() => {
    const ox = frameOf("down", 0) * PERSON.w
    return runsOf(paintPerson(l), ox, 0, PERSON.w, PERSON.h)
  }, [l.role, l.skin, l.hair, l.style]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg
      width={size}
      height={(size * PERSON.h) / PERSON.w}
      viewBox={`0 0 ${PERSON.w} ${PERSON.h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} fillOpacity={r.a / 255} />
      ))}
    </svg>
  )
}
