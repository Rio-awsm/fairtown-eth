import type { LotStatus } from "@fairtown/shared/keys"
import { fs } from "../textScale"
import { GameObjects, type Scene } from "phaser"
import { GOOD_OF } from "../art/props"
import { TOWN_TEXT } from "../art/text"
import { ART } from "../art/textures"
import type { TownCommand } from "../commands"
import { countdown } from "./slots"

const TEXT = { ...TOWN_TEXT, strokeThickness: 2 }
/** Awning tint by status: green while open, blue when sold, gold when paid, red on trouble. */
export const STATUS_COLOUR: Partial<Record<LotStatus, number>> = {
  open: 0x5fc25a,
  sold: 0x4d8fe0,
  truck_booked: 0x4d8fe0,
  picked_up: 0x8a6be0,
  delivered: 0x8a6be0,
  paid_in_full: 0xf2b33d,
  no_show_reported: 0xe0483b,
  disputed: 0xe07a2a,
  refunded: 0xb03a3a,
  relisted: 0xa3a9b0,
}
const STATUS_LABEL: Partial<Record<LotStatus, string>> = {
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

type Place = TownCommand & { kind: "placeStall" }

/** One stall: icon, qty, floor or live price in the lot's currency, status, countdown and badges. */
export class StallView extends GameObjects.Container {
  readonly seller: string
  private readonly box: GameObjects.Image
  private readonly glow: GameObjects.Image
  private readonly title: GameObjects.Text
  private readonly price: GameObjects.Text
  private readonly status: GameObjects.Text
  private readonly timer: GameObjects.Text
  private readonly badge: GameObjects.Text
  private readonly endBlock: number
  private current: LotStatus = "open"
  private deadline: number | undefined
  private block = 0
  private noShow = false

  constructor(scene: Scene, at: { x: number; y: number }, c: Place, above: boolean) {
    super(scene, at.x, at.y)
    this.seller = c.seller
    this.endBlock = c.endBlock
    const good = GOOD_OF[c.commodity] ?? "unknown"
    this.glow = scene.add.image(0, -2, ART.glow).setScale(1.1).setBlendMode("ADD").setAlpha(0)
    const counter = scene.add.image(0, 6, ART.counter).setOrigin(0.5, 1)
    this.box = scene.add
      .image(0, -4, ART.awning)
      .setOrigin(0.5, 0.5)
      .setTint(c.slot === null ? (STATUS_COLOUR.relisted ?? 0xffffff) : (STATUS_COLOUR.open ?? 0xffffff))
    const icon = scene.add.image(0, 1, ART.good(good)).setOrigin(0.5, 1)
    const dir = above ? -1 : 1
    // Line height follows the text size, so demo mode's bigger text never overlaps.
    const line = Math.ceil(parseFloat(fs(4))) + 1
    const oy = (n: number) => dir * ((above ? 10 : 8) + n * line)
    const origin = above ? 1 : 0
    this.title = scene.add
      .text(0, oy(0), `${c.qty} ${c.unit} ${c.commodity}`, { ...TEXT, fontSize: fs(4) })
      .setOrigin(0.5, origin)
    this.price = scene.add
      .text(0, oy(1), c.floorLabel, { ...TEXT, fontSize: fs(4), color: "#c6f6a8" })
      .setOrigin(0.5, origin)
    this.status = scene.add.text(0, oy(2), "Open", { ...TEXT, fontSize: fs(4) }).setOrigin(0.5, origin)
    this.timer = scene.add.text(0, oy(3), "", { ...TEXT, fontSize: fs(4), color: "#ffe08a" }).setOrigin(0.5, origin)
    // Beside the counter, clear of the label lines above or below the stall.
    this.badge = scene.add
      .text(12, 1, "", {
        ...TEXT,
        fontSize: fs(4),
        strokeThickness: 0,
        backgroundColor: "#3f7d45",
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0, 0.5)
    this.add([this.glow, counter, icon, this.box, this.title, this.price, this.status, this.timer, this.badge])
    scene.add.existing(this)
  }

  /** Clicking the stall opens its lot panel (S3 1.4). */
  onSelect(fn: () => void): void {
    this.box.setInteractive({ useHandCursor: true }).on("pointerdown", fn)
  }

  setClock(block: number): void {
    this.block = block
    this.drawTimer()
  }

  setStatus(status: LotStatus, deadlineBlock?: number): void {
    this.current = status
    this.deadline = deadlineBlock
    this.box.setTint(STATUS_COLOUR[status] ?? 0xffffff).setAlpha(1)
    this.status.setText(this.noShow && status === "refunded" ? "No-show" : (STATUS_LABEL[status] ?? status))
    this.glow.setAlpha(status === "paid_in_full" ? 0.8 : 0)
    this.drawTimer()
  }

  /** price.tick: new clearing price, and the label pulses. */
  setPrice(label: string | undefined, bids: number, speed: number): void {
    if (label) {
      this.price.setText(`now ${label}`)
      this.scene.tweens.add({ targets: this.price, scale: 1.4, duration: 120 / speed, yoyo: true })
    }
    this.title.setData("bids", bids)
  }

  flash(speed: number): void {
    this.scene.tweens.add({ targets: this.glow, alpha: { from: 0.9, to: 0 }, duration: 600 / speed, repeat: 1 })
  }

  fade(newFloor?: string): void {
    this.box.setAlpha(0.45)
    if (newFloor) this.price.setText(`relisted at ${newFloor}`)
  }

  setTier(tier: "new" | "proven"): void {
    if (!this.noShow) this.badge.setText(tier === "proven" ? "Proven" : "New")
  }

  markNoShow(): void {
    this.noShow = true
    this.badge.setText("No-show").setBackgroundColor("#a3322a")
    this.status.setText("No-show")
  }

  setRefundBadge(label: string): void {
    this.badge.setText(label).setBackgroundColor("#b4561a")
  }

  private drawTimer(): void {
    if (this.current === "open")
      return void this.timer.setText(`ends in ${countdown(this.endBlock, this.block)}`).setColor("#ffe08a")
    if (this.deadline === undefined) return void this.timer.setText("")
    if (this.current === "no_show_reported")
      return void this.timer.setText(`seller can answer ${countdown(this.deadline, this.block)}`).setColor("#ffb4a8")
    if (this.current === "sold" || this.current === "truck_booked")
      return void this.timer.setText(`pickup by ${countdown(this.deadline, this.block)}`).setColor("#ffe08a")
    this.timer.setText("")
  }
}
