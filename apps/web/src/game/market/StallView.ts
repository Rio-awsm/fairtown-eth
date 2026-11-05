import type { LotStatus } from "@fairtown/shared/keys"
import { GameObjects, type Scene } from "phaser"
import type { TownCommand } from "../commands"
import { countdown } from "./slots"

const TEXT = { fontFamily: "monospace", color: "#f8fafc", stroke: "#0f172a", strokeThickness: 2, resolution: 3 }
const ICON: Record<string, { glyph: string; colour: number }> = {
  cod: { glyph: "F", colour: 0x38bdf8 },
  haddock: { glyph: "F", colour: 0x38bdf8 },
  tomato: { glyph: "T", colour: 0xef4444 },
  onion: { glyph: "O", colour: 0xc084fc },
  marigold: { glyph: "M", colour: 0xf59e0b },
  rose: { glyph: "R", colour: 0xf43f5e },
  truck_capacity: { glyph: "K", colour: 0xf97316 },
  cargo_slot: { glyph: "A", colour: 0xf97316 },
  storage_slot: { glyph: "V", colour: 0x67e8f9 },
  gpu_hour: { glyph: "G", colour: 0x22c55e },
}
const STATUS_COLOUR: Partial<Record<LotStatus, number>> = {
  open: 0x0f766e,
  sold: 0x1d4ed8,
  truck_booked: 0x1d4ed8,
  picked_up: 0x4338ca,
  delivered: 0x4338ca,
  paid_in_full: 0xca8a04,
  no_show_reported: 0xb91c1c,
  disputed: 0x9a3412,
  refunded: 0x7f1d1d,
  relisted: 0x475569,
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
  private readonly box: GameObjects.Rectangle
  private readonly glow: GameObjects.Rectangle
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
    const icon = ICON[c.commodity] ?? { glyph: "?", colour: 0x94a3b8 }
    this.glow = scene.add.rectangle(0, 0, 16, 14, 0xfde047).setAlpha(0)
    this.box = scene.add.rectangle(0, 0, 12, 10, c.slot === null ? 0x475569 : 0x0f766e).setStrokeStyle(1, 0x0f172a)
    const iconBox = scene.add.rectangle(0, 0, 6, 6, icon.colour)
    const glyph = scene.add.text(0, 0, icon.glyph, { ...TEXT, fontSize: "5px", strokeThickness: 1 }).setOrigin(0.5)
    const dir = above ? -1 : 1
    const oy = (n: number) => dir * (7 + n * 5)
    const origin = above ? 1 : 0
    this.title = scene.add
      .text(0, oy(0), `${c.qty} ${c.unit} ${c.commodity}`, { ...TEXT, fontSize: "4px" })
      .setOrigin(0.5, origin)
    this.price = scene.add
      .text(0, oy(1), c.floorLabel, { ...TEXT, fontSize: "4px", color: "#a7f3d0" })
      .setOrigin(0.5, origin)
    this.status = scene.add.text(0, oy(2), "Open", { ...TEXT, fontSize: "4px" }).setOrigin(0.5, origin)
    this.timer = scene.add.text(0, oy(3), "", { ...TEXT, fontSize: "4px", color: "#fde68a" }).setOrigin(0.5, origin)
    this.badge = scene.add.text(8, -8, "", { ...TEXT, fontSize: "4px", backgroundColor: "#334155" }).setOrigin(0, 1)
    this.add([this.glow, this.box, iconBox, glyph, this.title, this.price, this.status, this.timer, this.badge])
    scene.add.existing(this)
  }

  setClock(block: number): void {
    this.block = block
    this.drawTimer()
  }

  setStatus(status: LotStatus, deadlineBlock?: number): void {
    this.current = status
    this.deadline = deadlineBlock
    this.box.setFillStyle(STATUS_COLOUR[status] ?? 0x0f766e).setAlpha(1)
    this.status.setText(this.noShow && status === "refunded" ? "No-show" : (STATUS_LABEL[status] ?? status))
    this.glow.setAlpha(status === "paid_in_full" ? 0.6 : 0)
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
    this.box.setAlpha(0.4)
    if (newFloor) this.price.setText(`relisted at ${newFloor}`)
  }

  setTier(tier: "new" | "proven"): void {
    if (!this.noShow) this.badge.setText(tier === "proven" ? "Proven" : "New")
  }

  markNoShow(): void {
    this.noShow = true
    this.badge.setText("No-show").setBackgroundColor("#7f1d1d")
    this.status.setText("No-show")
  }

  setRefundBadge(label: string): void {
    this.badge.setText(label).setBackgroundColor("#9a3412")
  }

  private drawTimer(): void {
    if (this.current === "open")
      return void this.timer.setText(`ends in ${countdown(this.endBlock, this.block)}`).setColor("#fde68a")
    if (this.deadline === undefined) return void this.timer.setText("")
    if (this.current === "no_show_reported")
      return void this.timer.setText(`seller can answer ${countdown(this.deadline, this.block)}`).setColor("#fca5a5")
    if (this.current === "sold" || this.current === "truck_booked")
      return void this.timer.setText(`pickup by ${countdown(this.deadline, this.block)}`).setColor("#fde68a")
    this.timer.setText("")
  }
}
