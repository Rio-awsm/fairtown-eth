import type { Role } from "@fairtown/shared/keys"
import { fs } from "../textScale"
import { GameObjects, type Scene } from "phaser"
import { BUBBLE_MAX } from "../commands"
import type { Point } from "../map/anchors"
import { facing, type Facing } from "./facing"

/** Milliseconds per tile at 1× replay. */
export const STEP_MS = 160
const FACINGS: readonly Facing[] = ["down", "left", "right", "up"]
const ROLE_COLOUR: Record<Role, number> = {
  NONE: 0x94a3b8,
  SELLER: 0x22c55e,
  BUYER: 0x60a5fa,
  TRUCK: 0xf97316,
  STORAGE: 0x38bdf8,
  SOCIETY: 0xa78bfa,
  HUMAN: 0xfacc15,
}
const ROLE_BADGE: Record<Role, string> = {
  NONE: "",
  SELLER: "S",
  BUYER: "B",
  TRUCK: "T",
  STORAGE: "C",
  SOCIETY: "P",
  HUMAN: "★",
}
const TEXT = { fontFamily: "monospace", color: "#f8fafc", stroke: "#0f172a", strokeThickness: 2, resolution: 3 }

/** Placeholder bodies until persona sheets land: a role-coloured disc with a notch for the facing. */
export function ensurePlaceholderTextures(scene: Scene): void {
  for (const role of Object.keys(ROLE_COLOUR) as Role[]) {
    for (const f of FACINGS) {
      const key = `agent:${role}:${f}`
      if (scene.textures.exists(key)) continue
      const g = scene.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(ROLE_COLOUR[role]).fillCircle(6, 6, 5)
      const notch = { down: [5, 9], up: [5, 1], left: [1, 5], right: [9, 5] }[f]
      g.fillStyle(0x0f172a).fillRect(notch[0]!, notch[1]!, 2, 2)
      g.generateTexture(key, 12, 12)
      g.destroy()
    }
  }
}

export type AgentLook = { agentId: string; label: string; role: Role; sprite: string; highlight: boolean }

/**
 * One town agent: 4-direction body, role badge, name label and a speech bubble (max 80 characters).
 * Persona sheets (`sprite:<name>`, 16 px frames, one row per facing: down, left, right, up) replace
 * the placeholder when loaded. Pooled: `reset` reuses an instance for a new agent.
 */
export class AgentSprite extends GameObjects.Container {
  agentId = ""
  private look!: AgentLook
  private face: Facing = "down"
  private readonly figure: GameObjects.Image
  private readonly badge: GameObjects.Text
  private readonly nameTag: GameObjects.Text
  private bubble: GameObjects.Text | undefined
  private bubbleTimer: Phaser.Time.TimerEvent | undefined
  private walkTween: Phaser.Tweens.Tween | undefined
  private stepMs = STEP_MS

  constructor(scene: Scene, onSelect?: (agentId: string) => void) {
    super(scene, 0, 0)
    this.figure = scene.add.image(0, 0, "agent:NONE:down")
    this.badge = scene.add.text(6, -8, "", { ...TEXT, fontSize: fs(5) }).setOrigin(0.5, 1)
    this.nameTag = scene.add.text(0, 7, "", { ...TEXT, fontSize: fs(5) }).setOrigin(0.5, 0)
    this.add([this.figure, this.badge, this.nameTag])
    if (onSelect) this.figure.setInteractive({ useHandCursor: true }).on("pointerdown", () => onSelect(this.agentId))
    scene.add.existing(this)
    this.setActive(false).setVisible(false)
  }

  get walking(): boolean {
    return this.walkTween?.isPlaying() ?? false
  }

  reset(look: AgentLook, at: Point): this {
    this.stopWalking()
    this.clearBubble()
    this.look = look
    this.agentId = look.agentId
    this.face = "down"
    this.badge.setText(ROLE_BADGE[look.role])
    this.nameTag.setText(look.label).setColor(look.highlight ? "#facc15" : "#f8fafc")
    this.setPosition(at.x, at.y).setActive(true).setVisible(true)
    this.refreshTexture()
    return this
  }

  /** Use the persona sheet if it has loaded, else the placeholder. */
  refreshTexture(): void {
    const sheet = `sprite:${this.look.sprite}`
    if (this.scene.textures.exists(sheet)) this.figure.setTexture(sheet, FACINGS.indexOf(this.face) * 4)
    else this.figure.setTexture(`agent:${this.look.role}:${this.face}`)
  }

  setSpeed(speed: number): void {
    this.stepMs = STEP_MS / Math.max(1, speed)
  }

  /** Walk tile by tile along waypoints; a new walk replaces the current one. */
  walk(path: Point[], onArrive?: () => void): void {
    this.stopWalking()
    const step = (i: number) => {
      const next = path[i]
      if (!next) return onArrive?.()
      this.face = facing(next.x - this.x, next.y - this.y, this.face)
      this.refreshTexture()
      this.walkTween = this.scene.tweens.add({
        targets: this,
        x: next.x,
        y: next.y,
        duration: this.stepMs,
        onComplete: () => step(i + 1),
      })
    }
    step(0)
  }

  say(text: string): void {
    this.clearBubble()
    const capped = text.length > BUBBLE_MAX ? `${text.slice(0, BUBBLE_MAX - 1)}…` : text
    this.bubble = this.scene.add
      .text(0, -12, capped, { ...TEXT, fontSize: fs(5), backgroundColor: "#1e293b", wordWrap: { width: 90 } })
      .setOrigin(0.5, 1)
    this.add(this.bubble)
    // Bubbles last 2.5 s at 1× and shrink with the replay speed, like every other effect.
    this.bubbleTimer = this.scene.time.delayedCall((2500 * this.stepMs) / STEP_MS, () => this.clearBubble())
  }

  retire(): void {
    this.stopWalking()
    this.clearBubble()
    this.agentId = ""
    this.setActive(false).setVisible(false)
  }

  private stopWalking(): void {
    this.walkTween?.stop()
    this.walkTween = undefined
  }

  private clearBubble(): void {
    this.bubbleTimer?.remove()
    this.bubbleTimer = undefined
    this.bubble?.destroy()
    this.bubble = undefined
  }
}
