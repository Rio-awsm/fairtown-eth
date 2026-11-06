import type { Role } from "@fairtown/shared/keys"
import { fs } from "../textScale"
import { GameObjects, type Scene } from "phaser"
import { frameOf, lookFor, PERSON } from "../art/people"
import { P } from "../art/palette"
import { TOWN_TEXT } from "../art/text"
import { ensurePerson } from "../art/textures"
import { BUBBLE_MAX } from "../commands"
import type { Point } from "../map/anchors"
import { facing, type Facing } from "./facing"

const FACINGS: readonly Facing[] = ["down", "left", "right", "up"]
const ROLE_NAME: Record<Role, string> = {
  NONE: "",
  SELLER: "seller",
  BUYER: "buyer",
  TRUCK: "driver",
  STORAGE: "storage",
  SOCIETY: "society",
  HUMAN: "walk-in",
}

/** Name tags show for highlighted people, on hover, and when the agent is selected; never all at once. */
export function nameTagShown(s: { highlight: boolean; hover: boolean; selected: boolean }): boolean {
  return s.highlight || s.hover || s.selected
}

/** Milliseconds per tile at 1× replay. */
export const STEP_MS = 160

export type AgentLook = { agentId: string; label: string; role: Role; sprite: string; highlight: boolean }

/**
 * One town agent: a painted pixel person (4 facings, 2-step walk), a name tag on hover or highlight,
 * and a speech bubble (max 80 characters). Persona sheets (`sprite:<name>`, 16 px frames, one row
 * per facing: down, left, right, up) replace the painted look when loaded. Pooled: `reset` reuses
 * an instance for a new agent.
 */
export class AgentSprite extends GameObjects.Container {
  agentId = ""
  private look!: AgentLook
  private face: Facing = "down"
  private step: 0 | 1 | 2 = 0
  private hover = false
  private selected = false
  private readonly figure: GameObjects.Image
  private readonly nameTag: GameObjects.Text
  private bubble: GameObjects.Text | undefined
  private bubbleTimer: Phaser.Time.TimerEvent | undefined
  private walkTween: Phaser.Tweens.Tween | undefined
  private stepMs = STEP_MS

  constructor(scene: Scene, onSelect?: (agentId: string) => void) {
    super(scene, 0, 0)
    // Feet on the tile centre, like a classic top-down sprite.
    this.figure = scene.add.image(0, 4, "__DEFAULT").setOrigin(0.5, 1)
    this.nameTag = scene.add
      .text(0, -PERSON.h + 2, "", { ...TOWN_TEXT, fontSize: fs(5), strokeThickness: 2 })
      .setOrigin(0.5, 1)
    this.add([this.figure, this.nameTag])
    this.figure
      .setInteractive({ useHandCursor: Boolean(onSelect) })
      .on("pointerover", () => this.setHover(true))
      .on("pointerout", () => this.setHover(false))
    if (onSelect) this.figure.on("pointerdown", () => onSelect(this.agentId))
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
    this.step = 0
    this.hover = false
    this.selected = false
    const role = ROLE_NAME[look.role]
    this.nameTag.setText(role ? `${look.label} · ${role}` : look.label).setColor(look.highlight ? P.coin : P.white)
    this.showTag()
    this.setPosition(at.x, at.y).setActive(true).setVisible(true)
    this.refreshTexture()
    return this
  }

  /** Selection from the HUD: keeps the name tag up while the agent's panel is open. */
  setSelected(on: boolean): void {
    this.selected = on
    this.showTag()
  }

  private setHover(on: boolean): void {
    this.hover = on
    this.showTag()
  }

  private showTag(): void {
    this.nameTag.setVisible(
      nameTagShown({ highlight: this.look?.highlight ?? false, hover: this.hover, selected: this.selected }),
    )
    // Shown tags sit above the crowd.
    this.setDepth(this.nameTag.visible ? 24 : 20)
  }

  /** Use the persona sheet if it has loaded, else the painted look for this agent. */
  refreshTexture(): void {
    const sheet = `sprite:${this.look.sprite}`
    if (this.scene.textures.exists(sheet)) return void this.figure.setTexture(sheet, FACINGS.indexOf(this.face) * 4)
    const key = ensurePerson(this.scene, lookFor(this.look.agentId, this.look.role))
    this.figure.setTexture(key, frameOf(this.face, this.step))
  }

  setSpeed(speed: number): void {
    this.stepMs = STEP_MS / Math.max(1, speed)
  }

  /** Walk tile by tile along waypoints; a new walk replaces the current one. */
  walk(path: Point[], onArrive?: () => void): void {
    this.stopWalking()
    const step = (i: number) => {
      const next = path[i]
      if (!next) {
        this.step = 0
        this.refreshTexture()
        return onArrive?.()
      }
      this.face = facing(next.x - this.x, next.y - this.y, this.face)
      this.step = i % 2 === 0 ? 1 : 2
      this.refreshTexture()
      this.walkTween = this.scene.tweens.add({
        targets: this,
        x: next.x,
        y: next.y,
        duration: this.stepMs,
        onComplete: () => step(i + 1),
      })
    }
    this.walkTween = undefined
    step(0)
  }

  say(text: string): void {
    this.clearBubble()
    const capped = text.length > BUBBLE_MAX ? `${text.slice(0, BUBBLE_MAX - 1)}…` : text
    this.bubble = this.scene.add
      .text(0, -PERSON.h - 2, capped, {
        ...TOWN_TEXT,
        fontSize: fs(5),
        color: P.ink,
        strokeThickness: 0,
        backgroundColor: P.parchment,
        padding: { x: 3, y: 2 },
        wordWrap: { width: 96 },
      })
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
