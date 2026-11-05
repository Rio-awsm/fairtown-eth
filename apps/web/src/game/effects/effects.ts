import { GameObjects, type Scene } from "phaser"
import type { Point } from "../map/anchors"

/** Scene effects for S3 1.3. Durations divide by the replay speed. Weather and lights are static, so baselines are stable. */
const TEXT = { fontFamily: "monospace", color: "#f8fafc", stroke: "#0f172a", strokeThickness: 2, resolution: 3 }
const DEPTH = { overlay: 5, effect: 35 } as const

function arc(
  scene: Scene,
  obj: GameObjects.GameObject & { x: number; y: number },
  from: Point,
  to: Point,
  ms: number,
  then?: () => void,
) {
  const lift = Math.max(16, Math.abs(to.x - from.x) / 3)
  const t = { v: 0 }
  scene.tweens.add({
    targets: t,
    v: 1,
    duration: ms,
    onUpdate: () => {
      obj.x = from.x + (to.x - from.x) * t.v
      obj.y = from.y + (to.y - from.y) * t.v - Math.sin(Math.PI * t.v) * lift
    },
    onComplete: () => {
      obj.destroy()
      then?.()
    },
  })
}

export function coinArc(scene: Scene, from: Point, to: Point, speed: number): void {
  const coin = scene.add.circle(from.x, from.y, 2, 0xfacc15).setStrokeStyle(1, 0xa16207).setDepth(DEPTH.effect)
  arc(scene, coin, from, to, 500 / speed)
}

export function refundCoins(scene: Scene, from: Point, to: Point, label: string, speed: number): void {
  for (let i = 0; i < 3; i++) {
    const coin = scene.add.circle(from.x, from.y, 2, 0xfacc15).setStrokeStyle(1, 0xa16207).setDepth(DEPTH.effect)
    scene.time.delayedCall((i * 120) / speed, () => arc(scene, coin, from, to, 600 / speed))
  }
  if (label) floatText(scene, from, `${label} back`, "#fca5a5", speed)
}

export function moveCrate(scene: Scene, from: Point, to: Point, speed: number): void {
  const crate = scene.add.rectangle(from.x, from.y, 6, 6, 0x92400e).setStrokeStyle(1, 0x451a03).setDepth(DEPTH.effect)
  scene.tweens.add({ targets: crate, x: to.x, y: to.y, duration: 700 / speed, onComplete: () => crate.destroy() })
}

export function vaultDoor(scene: Scene, at: Point, speed: number): void {
  const door = scene.add
    .rectangle(at.x, at.y - 10, 14, 10, 0x67e8f9)
    .setStrokeStyle(1, 0x0e7490)
    .setDepth(DEPTH.effect)
  scene.tweens.add({
    targets: door,
    scaleX: 0.15,
    duration: 300 / speed,
    yoyo: true,
    hold: 900 / speed,
    onComplete: () => door.destroy(),
  })
}

export function magnifier(scene: Scene, at: Point, speed: number): void {
  const glass = scene.add.container(at.x + 10, at.y - 12).setDepth(DEPTH.effect)
  glass.add([
    scene.add.circle(0, 0, 4).setStrokeStyle(1.5, 0xf8fafc),
    scene.add.line(0, 0, 3, 3, 7, 7, 0xf8fafc).setLineWidth(1.5),
  ])
  scene.time.delayedCall(1500 / speed, () => glass.destroy())
}

export function floatText(scene: Scene, at: Point, text: string, colour: string, speed: number): void {
  const t = scene.add
    .text(at.x, at.y - 10, text, { ...TEXT, fontSize: "5px", color: colour })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.effect)
  scene.tweens.add({ targets: t, y: at.y - 22, alpha: 0, duration: 1200 / speed, onComplete: () => t.destroy() })
}

/** Weather, lights and plaques per building; each replaces the last one of its kind there. */
export class Sky {
  private readonly weather = new Map<string, GameObjects.Container>()
  private readonly lights = new Map<string, GameObjects.Container>()
  private readonly plaques = new Map<string, GameObjects.Text>()
  private night: GameObjects.Rectangle | undefined

  constructor(private readonly scene: Scene) {}

  storm(key: string, at: Point, label: string): void {
    this.weather.get(key)?.destroy()
    const c = this.scene.add.container(at.x, at.y - 40).setDepth(DEPTH.effect)
    for (const [dx, dy, r] of [
      [-14, 0, 7],
      [-4, -4, 9],
      [8, 0, 7],
      [16, 2, 5],
    ] as const)
      c.add(this.scene.add.circle(dx, dy, r, 0x64748b).setAlpha(0.9))
    for (let i = 0; i < 9; i++)
      c.add(this.scene.add.line(0, 0, -18 + i * 4, 8, -21 + i * 4, 16, 0x93c5fd).setLineWidth(1))
    c.add(this.scene.add.text(0, -12, label, { ...TEXT, fontSize: "4px" }).setOrigin(0.5, 1))
    this.weather.set(key, c)
  }

  quiet(key: string, at: Point, label: string): void {
    this.weather.get(key)?.destroy()
    const c = this.scene.add.container(at.x, at.y - 40).setDepth(DEPTH.effect)
    c.add(this.scene.add.rectangle(0, 20, 120, 60, 0x0f172a).setAlpha(0.35))
    c.add(this.scene.add.text(0, -4, label, { ...TEXT, fontSize: "4px", color: "#cbd5e1" }).setOrigin(0.5, 1))
    this.weather.set(key, c)
  }

  festival(key: string, at: Point, label: string): void {
    this.lights.get(key)?.destroy()
    const c = this.scene.add.container(at.x, at.y + 4).setDepth(DEPTH.effect)
    const colours = [0xfacc15, 0xf97316, 0xec4899, 0x22c55e, 0x38bdf8]
    for (let i = 0; i < 15; i++)
      c.add(this.scene.add.circle(-56 + i * 8, Math.sin(i / 2) * 2, 1.5, colours[i % colours.length]!))
    c.add(this.scene.add.text(0, -4, label, { ...TEXT, fontSize: "4px", color: "#fde68a" }).setOrigin(0.5, 1))
    this.lights.set(key, c)
  }

  setNight(on: boolean, size: { w: number; h: number }): void {
    this.night ??= this.scene.add.rectangle(size.w / 2, size.h / 2, size.w, size.h, 0x020617).setDepth(DEPTH.overlay)
    this.night.setAlpha(on ? 0.35 : 0)
  }

  private tint: GameObjects.Graphics | undefined

  /** Price weather: a translucent wash over each building in its band colour; null clears it. */
  priceWeather(areas: { colour: number; x: number; y: number; w: number; h: number }[] | null): void {
    this.tint?.destroy()
    this.tint = undefined
    if (!areas) return
    const g = this.scene.add.graphics().setDepth(DEPTH.overlay + 1)
    for (const a of areas) g.fillStyle(a.colour, 0.45).fillRect(a.x, a.y, a.w, a.h)
    this.tint = g
  }

  plaque(key: string, at: Point, text: string): void {
    this.plaques.get(key)?.destroy()
    const t = this.scene.add
      .text(at.x, at.y + 2, text, {
        ...TEXT,
        fontSize: "4px",
        color: "#0f172a",
        stroke: "#fef3c7",
        backgroundColor: "#fde68a",
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.effect)
    this.plaques.set(key, t)
  }
}
