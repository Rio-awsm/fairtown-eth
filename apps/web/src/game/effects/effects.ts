import { GameObjects, type Scene } from "phaser"
import { fs } from "../textScale"
import type { Point } from "../map/anchors"
import { TOWN_TEXT } from "../art/text"
import { ART, BULB_COLOURS } from "../art/textures"

/** Scene effects for S3 1.3. Durations divide by the replay speed. Weather and lights are static, so baselines are stable. */
const TEXT = { ...TOWN_TEXT, strokeThickness: 2 }
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

/** A gold coin that spins (scaleX) while it flies. */
function coin(scene: Scene, at: Point, speed: number) {
  const c = scene.add.image(at.x, at.y, ART.coin).setDepth(DEPTH.effect)
  const spin = scene.tweens.add({
    targets: c,
    scaleX: { from: 1, to: 0.2 },
    duration: 140 / speed,
    yoyo: true,
    repeat: -1,
  })
  // The spin repeats forever, so it must end with the coin or it keeps the scene animating.
  c.once("destroy", () => spin.remove())
  return c
}

export function coinArc(scene: Scene, from: Point, to: Point, speed: number): void {
  arc(scene, coin(scene, from, speed), from, to, 500 / speed)
}

export function refundCoins(scene: Scene, from: Point, to: Point, label: string, speed: number): void {
  for (let i = 0; i < 3; i++) {
    const c = coin(scene, from, speed)
    scene.time.delayedCall((i * 120) / speed, () => arc(scene, c, from, to, 600 / speed))
  }
  if (label) floatText(scene, from, `${label} back`, "#fca5a5", speed)
}

export function moveCrate(scene: Scene, from: Point, to: Point, speed: number): void {
  const crate = scene.add.image(from.x, from.y, ART.crate).setDepth(DEPTH.effect)
  scene.tweens.add({ targets: crate, x: to.x, y: to.y, duration: 700 / speed, onComplete: () => crate.destroy() })
}

export function vaultDoor(scene: Scene, at: Point, speed: number): void {
  const door = scene.add
    .rectangle(at.x, at.y - 14, 22, 22, 0xc7d6de)
    .setStrokeStyle(2, 0x2a1f33)
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
    scene.add.circle(0, 0, 4, 0xbfe6f2, 0.5).setStrokeStyle(1.5, 0x2a1f33),
    scene.add.line(0, 0, 3, 3, 7, 7, 0x7a4b2a).setLineWidth(2),
  ])
  scene.time.delayedCall(1500 / speed, () => glass.destroy())
}

export function floatText(scene: Scene, at: Point, text: string, colour: string, speed: number): void {
  const t = scene.add
    .text(at.x, at.y - 10, text, { ...TEXT, fontSize: fs(5), color: colour })
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
    c.add(this.scene.add.image(-12, 0, ART.cloud))
    c.add(this.scene.add.image(14, 4, ART.cloud).setScale(0.8))
    // Fixed raindrops, not particles: storm baselines must match frame for frame.
    for (let i = 0; i < 14; i++) c.add(this.scene.add.image(-26 + i * 4, 14 + ((i * 5) % 9), ART.drop))
    c.add(this.scene.add.text(0, -10, label, { ...TEXT, fontSize: fs(4) }).setOrigin(0.5, 1))
    this.weather.set(key, c)
  }

  quiet(key: string, at: Point, label: string): void {
    this.weather.get(key)?.destroy()
    const c = this.scene.add.container(at.x, at.y - 40).setDepth(DEPTH.effect)
    c.add(this.scene.add.rectangle(0, 20, 120, 60, 0x2a1f33).setAlpha(0.3))
    c.add(this.scene.add.text(0, -4, label, { ...TEXT, fontSize: fs(4), color: "#e6e2da" }).setOrigin(0.5, 1))
    this.weather.set(key, c)
  }

  festival(key: string, at: Point, label: string): void {
    this.lights.get(key)?.destroy()
    // Along the roof, below the building's sign.
    const c = this.scene.add.container(at.x, at.y + 22).setDepth(DEPTH.effect)
    // A string of bulbs sagging between two posts, each with a soft glow.
    const wire = this.scene.add.graphics().lineStyle(1, 0x2a1f33)
    wire.beginPath()
    for (let i = 0; i <= 15; i++) wire.lineTo(-60 + i * 8, Math.sin((i / 15) * Math.PI) * 4)
    wire.strokePath()
    c.add(wire)
    for (let i = 0; i < 15; i++) {
      const x = -56 + i * 8
      const y = Math.sin(((i + 0.5) / 15) * Math.PI) * 4 + 2
      c.add(this.scene.add.image(x, y, ART.glow).setScale(0.35).setBlendMode("ADD").setAlpha(0.7))
      c.add(this.scene.add.image(x, y, ART.bulb(i % BULB_COLOURS.length)))
    }
    c.add(this.scene.add.text(0, 14, label, { ...TEXT, fontSize: fs(4), color: "#ffe08a" }).setOrigin(0.5, 0))
    this.lights.set(key, c)
  }

  setNight(on: boolean, size: { w: number; h: number }): void {
    this.night ??= this.scene.add.rectangle(size.w / 2, size.h / 2, size.w, size.h, 0x1b1f4a).setDepth(DEPTH.overlay)
    this.night.setAlpha(on ? 0.45 : 0)
    for (const glow of this.nightLights) glow.setVisible(on)
  }

  private nightLights: GameObjects.Image[] = []
  /** Window and lamp glows, shown only at night. */
  setNightLights(lights: GameObjects.Image[]): void {
    this.nightLights = lights
    const on = (this.night?.alpha ?? 0) > 0
    for (const l of lights) l.setVisible(on)
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
      // Hung above the building's sign so both stay readable.
      .text(at.x, at.y - 10, text, {
        ...TEXT,
        fontSize: fs(4),
        color: "#2a1f33",
        strokeThickness: 0,
        backgroundColor: "#f8eccb",
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.effect)
    this.plaques.set(key, t)
  }
}
