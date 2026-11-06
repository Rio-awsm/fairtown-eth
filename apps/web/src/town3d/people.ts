import type { Role } from "@fairtown/shared/keys"
import * as THREE from "three"
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"
import { BUBBLE_MAX } from "../game/commands"
import type { Point } from "../game/map/anchors"
import type { Clock } from "./clock"
import { TILE_PX } from "./coords"
import type { Models } from "./models"

/** Milliseconds per tile at 1× replay. */
export const STEP_MS = 160
/** How long a remark stays up at 1× replay. */
export const SAY_MS = 2500

const ROLE_NAME: Record<Role, string> = {
  NONE: "",
  SELLER: "seller",
  BUYER: "buyer",
  TRUCK: "driver",
  STORAGE: "storage",
  SOCIETY: "society",
  HUMAN: "walk-in",
}

/** Sellers, drivers and walk-in visitors are people; every other party is an AI agent. */
export const isPerson = (role: Role) => role === "SELLER" || role === "TRUCK" || role === "HUMAN"

/** Each AI agent's glow, by role, in the landing's accents. */
export const AGENT_GLOW: Record<Role, number> = {
  BUYER: 0x3fd8ff,
  STORAGE: 0x8ea8ff,
  SOCIETY: 0xff7ab6,
  NONE: 0xc6ff2e,
  SELLER: 0xffb35c,
  TRUCK: 0xffb35c,
  HUMAN: 0xffb35c,
}

export const PEOPLE = ["a", "b", "c", "d"].flatMap((k) => [
  `mini-characters/character-male-${k}`,
  `mini-characters/character-female-${k}`,
])

/** Name tags show for highlighted people, on hover, and when the agent is selected; never all at once. */
export function nameTagShown(s: { highlight: boolean; hover: boolean; selected: boolean }): boolean {
  return s.highlight || s.hover || s.selected
}

/** The tag's words: "Name · role", or just the name for a party without a role. */
export const tagText = (label: string, role: Role) => (ROLE_NAME[role] ? `${label} · ${ROLE_NAME[role]}` : label)

/** A fixed pick for an id, so the same agent always looks the same. */
export function pick<T>(id: string, list: readonly T[]): T {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return list[(h >>> 0) % list.length]!
}

/** A path as a polyline with lengths, for walking at a steady pace. */
export function polyline(points: Point[]): { at(d: number): Point & { heading: number }; total: number } {
  const lengths = [0]
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y))
  const total = lengths[lengths.length - 1] ?? 0
  return {
    total,
    at(d) {
      if (points.length === 1 || total === 0) return { ...points[0]!, heading: 0 }
      const dd = Math.min(total, Math.max(0, d))
      let i = 1
      while (i < lengths.length - 1 && lengths[i]! < dd) i++
      const a = points[i - 1]!
      const b = points[i]!
      const seg = lengths[i]! - lengths[i - 1]! || 1
      const t = (dd - lengths[i - 1]!) / seg
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.x - a.x, b.y - a.y) }
    },
  }
}

export type AgentLook = { agentId: string; label: string; role: Role; sprite: string; highlight: boolean }

const ORB = new THREE.SphereGeometry(0.26, 24, 16)
const SHADOW = new THREE.CircleGeometry(0.26, 20).rotateX(-Math.PI / 2)
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
const RING = new THREE.RingGeometry(0.24, 0.3, 32).rotateX(-Math.PI / 2)

const el = (cls: string, text = "") => {
  const d = document.createElement("div")
  d.className = cls
  d.textContent = text
  return d
}

/**
 * One party in the 3D town. People (sellers, drivers, walk-ins) are Kenney's rigged characters,
 * walking and idling with their own animations; AI agents are glowing orbs that float. Names and
 * speech are DOM chips pinned in 3D, sharp and readable at any distance. Positions stay in map
 * pixels, so the pathfinder and the e2e probe read them as before. Pooled: `reset` reuses one.
 */
export class Agent3D {
  agentId = ""
  x = 0
  y = 0
  readonly group = new THREE.Group()
  /** Meshes a click or hover can land on; each carries userData.agentId. */
  readonly hits: THREE.Object3D[] = []
  private look: AgentLook | undefined
  private person = false
  private hover = false
  private selected = false
  private body: THREE.Object3D | undefined
  private mixer: THREE.AnimationMixer | undefined
  private actions: Record<string, THREE.AnimationAction> = {}
  private playing = ""
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly tagEl = el("ft-tag")
  private readonly tag = new CSS2DObject(this.tagEl)
  private bubble: CSS2DObject | undefined
  private stopBubble: (() => void) | undefined
  private stopWalk: (() => void) | undefined
  private moving = false
  private heading = 0
  private stepMs = STEP_MS
  private readonly phase = Math.random() * Math.PI * 2
  private readonly shadow: THREE.Mesh

  constructor(
    private readonly clock: Clock,
    private readonly models: Models,
    onSelect?: (agentId: string) => void,
  ) {
    const shadow = new THREE.Mesh(SHADOW, SHADOW_MAT)
    shadow.position.y = 0.015
    this.shadow = shadow
    this.ring = new THREE.Mesh(
      RING,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
    )
    this.ring.position.y = 0.02
    this.tag.center.set(0.5, 1)
    this.group.add(shadow, this.ring, this.tag)
    this.group.visible = false
    this.tag.visible = false
    if (onSelect)
      this.tagEl.addEventListener("pointerdown", (e) => {
        e.stopPropagation()
        onSelect(this.agentId)
      })
  }

  get active(): boolean {
    return this.group.visible
  }

  get walking(): boolean {
    return this.moving
  }

  /** Where speech and money start, in world units. */
  get chest(): THREE.Vector3 {
    return this.group.position.clone().setY(this.person ? 0.55 : 0.75)
  }

  reset(look: AgentLook, at: Point): this {
    this.stopWalking()
    this.clearBubble()
    this.look = look
    this.agentId = look.agentId
    this.person = isPerson(look.role)
    // People stand on the ground and get a contact shadow; orbs float, lit by their own glow.
    this.shadow.visible = this.person
    this.build()
    this.setPosition(at)
    this.group.visible = true
    this.showTag()
    return this
  }

  private build() {
    if (this.body) this.group.remove(this.body)
    this.mixer?.stopAllAction()
    this.mixer = undefined
    this.actions = {}
    this.playing = ""
    this.hits.length = 0
    const look = this.look!
    const glow = AGENT_GLOW[look.role]
    this.ring.material.color.setHex(glow)
    if (this.person) {
      const key = pick(look.agentId, PEOPLE)
      const body = this.models.make(key, "keep", { h: 1.2 })
      const clips = this.models.animations(key)
      if (clips.length) {
        this.mixer = new THREE.AnimationMixer(body)
        for (const name of ["idle", "walk"]) {
          const clip = THREE.AnimationClip.findByName(clips, name)
          if (clip) this.actions[name] = this.mixer.clipAction(clip)
        }
      }
      body.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.userData.agentId = look.agentId
          this.hits.push(o)
        }
      })
      this.body = body
      this.tag.position.set(0, 1.5, 0)
      this.play("idle")
    } else {
      const body = new THREE.Group()
      // A self-lit orb: bloom gives it its glow, so it needs no halo of its own.
      const orb = new THREE.Mesh(ORB, new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(1.6) }))
      orb.position.y = 0.72
      orb.userData.agentId = look.agentId
      body.add(orb)
      this.hits.push(orb)
      this.body = body
      this.tag.position.set(0, 1.25, 0)
    }
    this.group.add(this.body)
  }

  private play(name: "idle" | "walk") {
    if (this.playing === name) return
    const next = this.actions[name]
    if (!next) return
    const prev = this.actions[this.playing]
    next.reset().fadeIn(0.18).play()
    prev?.fadeOut(0.18)
    this.playing = name
  }

  private setPosition(p: Point) {
    this.x = p.x
    this.y = p.y
    this.group.position.set(p.x / TILE_PX, 0, p.y / TILE_PX)
  }

  setSelected(on: boolean): void {
    this.selected = on
    this.showTag()
  }

  setHover(on: boolean): void {
    if (this.hover === on) return
    this.hover = on
    this.showTag()
  }

  setSpeed(speed: number): void {
    this.stepMs = STEP_MS / Math.max(1, speed)
  }

  private showTag() {
    const look = this.look
    if (!look) return
    const on = !this.bubble && nameTagShown({ highlight: look.highlight, hover: this.hover, selected: this.selected })
    this.tag.visible = on
    this.tagEl.textContent = tagText(look.label, look.role)
    this.tagEl.dataset.selected = String(this.selected)
    this.ring.material.opacity = this.selected ? 0.9 : look.highlight || this.hover ? 0.55 : 0
    // An invisible ring still costs a draw: skip it.
    this.ring.visible = this.ring.material.opacity > 0
  }

  /** Walk along waypoints (map pixels) at the replay's pace; a new walk replaces the current one. */
  walk(path: Point[], onArrive?: () => void): void {
    this.stopWalking()
    if (path.length === 0) return onArrive?.()
    const line = polyline([{ x: this.x, y: this.y }, ...path])
    this.moving = true
    this.play("walk")
    this.stopWalk = this.clock.tween(
      Math.max(1, (line.total / TILE_PX) * this.stepMs),
      (t) => {
        const p = line.at(line.total * t)
        if (line.total > 0) this.heading = p.heading
        this.setPosition(p)
      },
      () => {
        this.moving = false
        this.stopWalk = undefined
        this.play("idle")
        onArrive?.()
      },
    )
  }

  /** A remark in a glass chip over the head (max 80 characters), for 2.5 s at 1× replay. */
  say(text: string): void {
    this.clearBubble()
    const capped = text.length > BUBBLE_MAX ? `${text.slice(0, BUBBLE_MAX - 1)}…` : text
    const chip = el("ft-bubble")
    chip.append(el("ft-bubble-name", this.look?.label ?? ""), el("ft-bubble-text", capped))
    const bubble = new CSS2DObject(chip)
    bubble.center.set(0.5, 1)
    bubble.position.set(0, 1.55, 0)
    this.group.add(bubble)
    this.bubble = bubble
    this.showTag()
    this.stopBubble = this.clock.after((SAY_MS * this.stepMs) / STEP_MS, () => this.clearBubble())
  }

  get speaking(): boolean {
    return Boolean(this.bubble)
  }

  private clearBubble() {
    this.stopBubble?.()
    this.stopBubble = undefined
    if (!this.bubble) return
    this.group.remove(this.bubble)
    this.bubble.element.remove()
    this.bubble = undefined
    this.showTag()
  }

  /** Animate, turn and float; called every frame. `still` holds everyone at rest for baselines. */
  tick(t: number, dt: number, still: boolean): void {
    if (!this.group.visible || !this.body) return
    if (this.person) {
      const turn = ((this.heading - this.body.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      this.body.rotation.y += still ? turn : turn * Math.min(1, dt / 80)
      if (!still) this.mixer?.update((dt / 1000) * (this.moving ? Math.min(2.5, STEP_MS / this.stepMs) : 1))
      return
    }
    this.body.position.y = still ? 0 : Math.sin(t / 600 + this.phase) * 0.06
  }

  retire(): void {
    this.stopWalking()
    this.clearBubble()
    this.agentId = ""
    this.group.visible = false
    this.tag.visible = false
  }

  private stopWalking() {
    this.stopWalk?.()
    this.stopWalk = undefined
    this.moving = false
  }

  dispose(): void {
    this.retire()
    this.tagEl.remove()
  }
}
