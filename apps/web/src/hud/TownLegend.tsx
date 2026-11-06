import type { CSSProperties } from "react"
import { useState } from "react"
import type { Role } from "@fairtown/shared/keys"
import { STATUS_COLOUR } from "../town3d/stall"
import { ROLE_COLOUR, ROLE_WORD, cssHex } from "../town3d/theme"

const AGENTS: Role[] = ["BUYER", "STORAGE", "SOCIETY"]
const PEOPLE: Role[] = ["SELLER", "TRUCK", "HUMAN"]
const LOTS: { label: string; colour: number }[] = [
  { label: "Auction open", colour: STATUS_COLOUR.open! },
  { label: "Sold", colour: STATUS_COLOUR.sold! },
  { label: "On the road", colour: STATUS_COLOUR.picked_up! },
  { label: "Paid in full", colour: STATUS_COLOUR.paid_in_full! },
  { label: "Trouble", colour: STATUS_COLOUR.refunded! },
]

const swatch = (colour: number) => ({ "--c": cssHex(colour) }) as CSSProperties

/** What every colour and line in the town means (D-122), so a first look reads in seconds. */
export function TownLegend() {
  // Folded by default (D-122 minimal pass): one tap opens it.
  const [open, setOpen] = useState(false)
  return (
    <aside aria-label="Legend" className="rpg-window ft-legend" data-open={open}>
      <button type="button" className="ft-legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Key
      </button>
      {open && (
        <div className="ft-legend-body">
          <h3>AI agents</h3>
          <ul>
            {AGENTS.map((r) => (
              <li key={r}>
                <span aria-hidden="true" className="ft-key-orb" style={swatch(ROLE_COLOUR[r])} />
                {ROLE_WORD[r]}
              </li>
            ))}
          </ul>
          <h3>People</h3>
          <ul>
            {PEOPLE.map((r) => (
              <li key={r}>
                <span aria-hidden="true" className="ft-key-pin" style={swatch(ROLE_COLOUR[r])} />
                {ROLE_WORD[r]}
              </li>
            ))}
          </ul>
          <h3>Lots</h3>
          <ul>
            {LOTS.map((l) => (
              <li key={l.label}>
                <span aria-hidden="true" className="ft-key-pool" style={swatch(l.colour)} />
                {l.label}
              </li>
            ))}
          </ul>
          <h3>Lines</h3>
          <ul>
            <li>
              <span aria-hidden="true" className="ft-key-line" style={swatch(ROLE_COLOUR.BUYER)} />
              Bid
            </li>
            <li>
              <span aria-hidden="true" className="ft-key-line ft-key-dash" style={swatch(ROLE_COLOUR.BUYER)} />
              Walking to
            </li>
            <li>
              <span aria-hidden="true" className="ft-key-line ft-key-dash" style={swatch(ROLE_COLOUR.TRUCK)} />
              Truck route
            </li>
          </ul>
        </div>
      )}
    </aside>
  )
}
