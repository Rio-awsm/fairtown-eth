import type { LotStatus } from "@fairtown/shared/keys"
import * as THREE from "three"
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"
import type { TownCommand } from "../game/commands"
import type { Point } from "../game/map/anchors"
import { countdown } from "../game/market/slots"
import type { Clock } from "./clock"
import { TILE_PX } from "./coords"
import type { Models } from "./models"

/** Light under the stall by status: lime while open, cyan sold, violet on the road, gold paid, red trouble. */
export const STATUS_COLOUR: Partial<Record<LotStatus, number>> = {
  open: 0xc6ff2e,
  sold: 0x3fd8ff,
  truck_booked: 0x3fd8ff,
  picked_up: 0xa78bfa,
  delivered: 0xa78bfa,
  paid_in_full: 0xffc857,
  no_show_reported: 0xff6b5e,
  disputed: 0xff9f43,
  refunded: 0xff6b5e,
  relisted: 0x94a3b8,
}
export const STATUS_LABEL: Partial<Record<LotStatus, string>> = {
  open: "Open",
  sold: "Sold",
  truck_booked: "Truck booked",
  picked_up: "Picked up",
  delivered: "Delivered",
  paid_in_full: "Paid in full",
  no_show_reported: "No-show reported",
  disputed: "Disputed",
  refunded: "Refunded",
  relisted: "Relisted",
}

/** The stall's models, for loading up front. */
export const STALL_MODELS = ["city-commercial/detail-parasol-a", "city-commercial/detail-parasol-b"]

type Place = TownCommand & { kind: "placeStall" }

const COUNTER = new THREE.BoxGeometry(1.1, 0.4, 0.55).translate(0, 0.2, 0)
const COUNTER_MAT = new THREE.MeshStandardMaterial({ color: 0x343c4f, roughness: 0.75 })
const POOL = new THREE.CircleGeometry(0.95, 32).rotateX(-Math.PI / 2)
const BEAM = new THREE.CylinderGeometry(0.12, 0.3, 8, 20, 1, true).translate(0, 4, 0)

const line = (cls: string, text = "") => {
  const d = document.createElement("div")
  d.className = cls
  d.textContent = text
  return d
}

/**
 * One lot on sale: a market parasol over a counter, a pool of status-coloured light under it, and a
 * glass card with the price, the status, what is on sale, the countdown and a badge.
 */
export class Stall3D {
  readonly group = new THREE.Group()
  readonly seller: string
  readonly hits: THREE.Object3D[] = []
  private readonly pool: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  private readonly card = line("ft-stall")
  private readonly price: HTMLDivElement
  private readonly status = line("ft-stall-status", "Open")
  private readonly title: HTMLDivElement
  private readonly timer = line("ft-stall-timer")
  private readonly badge = line("ft-stall-badge")
  private readonly endBlock: number
  private current: LotStatus = "open"
  private deadline: number | undefined
  private block = 0
  private noShow = false
  private pulse = 0

  constructor(
    private readonly clock: Clock,
    models: Models,
    at: Point,
    c: Place,
    onSelect: () => void,
  ) {
    this.seller = c.seller
    this.endBlock = c.endBlock
    const colour = c.slot === null ? STATUS_COLOUR.relisted! : STATUS_COLOUR.open!
    const counter = new THREE.Mesh(COUNTER, COUNTER_MAT)
    counter.castShadow = true
    counter.receiveShadow = true
    const parasol = models.make(STALL_MODELS[(c.slot ?? 0) % 2]!, "keep", { h: 1.25 })
    parasol.position.z = -0.1
    this.pool = new THREE.Mesh(
      POOL,
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.pool.position.y = 0.03
    this.group.add(this.pool, counter, parasol)
    for (const o of [counter, parasol]) o.traverse((m) => m instanceof THREE.Mesh && this.hits.push(m))
    for (const h of this.hits) h.userData.lotId = c.lotId
    this.group.position.set(at.x / TILE_PX, 0, at.y / TILE_PX)

    this.price = line("ft-stall-price", c.floorLabel)
    this.title = line("ft-stall-title", `${c.qty} ${c.unit} ${c.commodity}`)
    this.card.append(this.price, this.status, this.title, this.timer, this.badge)
    this.badge.hidden = true
    this.card.dataset.status = c.slot === null ? "relisted" : "open"
    this.card.addEventListener("pointerdown", (e) => {
      e.stopPropagation()
      onSelect()
    })
    const label = new CSS2DObject(this.card)
    label.center.set(0.5, 1)
    label.position.set(0, 1.45, 0)
    this.group.add(label)
  }

  get x(): number {
    return this.group.position.x * TILE_PX
  }
  get y(): number {
    return this.group.position.z * TILE_PX
  }
  /** Where things land on the stall, in world units. */
  get top(): THREE.Vector3 {
    return this.group.position.clone().setY(0.55)
  }

  setClock(block: number): void {
    this.block = block
    this.drawTimer()
  }

  setStatus(status: LotStatus, deadlineBlock?: number): void {
    this.current = status
    this.deadline = deadlineBlock
    this.pool.material.color.setHex(STATUS_COLOUR[status] ?? 0xffffff)
    this.pool.material.opacity = status === "paid_in_full" ? 0.5 : 0.32
    this.status.textContent = this.noShow && status === "refunded" ? "No-show" : (STATUS_LABEL[status] ?? status)
    this.card.dataset.status = status
    this.card.classList.remove("ft-faded")
    this.drawTimer()
  }

  /** price.tick: the new clearing price, and the label pulses. */
  setPrice(label: string | undefined, _bids: number, speed: number): void {
    if (!label) return
    this.price.textContent = `now ${label}`
    this.price.classList.remove("ft-pulse")
    void this.price.offsetWidth
    this.price.style.animationDuration = `${Math.round(480 / Math.max(1, speed))}ms`
    this.price.classList.add("ft-pulse")
  }

  /** The price clears: a column of light rises from the stall. */
  flash(speed: number): void {
    const beam = new THREE.Mesh(
      BEAM,
      new THREE.MeshBasicMaterial({
        color: 0xfff1c9,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.group.add(beam)
    this.clock.tween(
      1200 / Math.max(1, speed),
      (t) => {
        beam.material.opacity = Math.sin(t * Math.PI) * 0.65
        beam.scale.set(1 + t * 0.6, 1, 1 + t * 0.6)
        this.pulse = Math.sin(t * Math.PI)
        this.pool.material.opacity = 0.32 + this.pulse * 0.5
      },
      () => {
        this.group.remove(beam)
        beam.material.dispose()
        this.pulse = 0
        this.pool.material.opacity = this.current === "paid_in_full" ? 0.5 : 0.32
      },
    )
  }

  fade(newFloor?: string): void {
    this.card.classList.add("ft-faded")
    this.pool.material.opacity = 0.12
    if (newFloor) this.price.textContent = `relisted at ${newFloor}`
  }

  setTier(tier: "new" | "proven"): void {
    if (this.noShow) return
    this.badge.hidden = false
    this.badge.textContent = tier === "proven" ? "Proven" : "New"
    this.badge.dataset.tone = tier
  }

  markNoShow(): void {
    this.noShow = true
    this.badge.hidden = false
    this.badge.textContent = "No-show"
    this.badge.dataset.tone = "bad"
    this.status.textContent = "No-show"
  }

  setRefundBadge(label: string): void {
    this.badge.hidden = false
    this.badge.textContent = label
    this.badge.dataset.tone = "warn"
  }

  private drawTimer(): void {
    const set = (text: string, tone = "") => {
      this.timer.textContent = text
      this.timer.dataset.tone = tone
      this.timer.hidden = text === ""
    }
    if (this.current === "open") return set(`ends in ${countdown(this.endBlock, this.block)}`)
    if (this.deadline === undefined) return set("")
    if (this.current === "no_show_reported")
      return set(`seller can answer ${countdown(this.deadline, this.block)}`, "bad")
    if (this.current === "sold" || this.current === "truck_booked")
      return set(`pickup by ${countdown(this.deadline, this.block)}`)
    set("")
  }

  dispose(): void {
    this.card.remove()
    this.pool.material.dispose()
  }
}
