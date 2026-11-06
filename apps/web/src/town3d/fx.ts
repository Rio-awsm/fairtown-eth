import * as THREE from "three"
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"
import { splitSign } from "../game/scenes/layout"
import type { Clock } from "./clock"

/** What an effect needs: somewhere to draw, a clock, and the replay speed. */
export type Fx = { root: THREE.Object3D; clock: Clock; speed: number }

const ORB = new THREE.SphereGeometry(1, 16, 12)
const RING = new THREE.TorusGeometry(1, 0.05, 8, 48)
const CRATE = new THREE.BoxGeometry(0.4, 0.3, 0.4)

const glowOrb = (colour: number, size: number) => {
  const orb = new THREE.Mesh(
    ORB,
    new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 3 }),
  )
  orb.scale.setScalar(size)
  return orb
}

function dispose(o: THREE.Object3D) {
  o.removeFromParent()
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) (c.material as THREE.Material).dispose()
    if (c instanceof CSS2DObject) c.element.remove()
  })
}

/** A point on a hop from a to b, `height` above the straight line at the middle. */
export function hop(a: THREE.Vector3, b: THREE.Vector3, height: number, t: number): THREE.Vector3 {
  const p = a.clone().lerp(b, t)
  p.y += Math.sin(Math.PI * t) * height
  return p
}

/** Money on the move: a bright orb with a short trail, hopping from one place to another. */
export function arc(fx: Fx, from: THREE.Vector3, to: THREE.Vector3, colour: number, ms = 900, done?: () => void) {
  const trail = [0, 1, 2].map((i) => glowOrb(colour, 0.1 - i * 0.025))
  for (const o of trail) fx.root.add(o)
  const height = 1 + from.distanceTo(to) * 0.25
  fx.clock.tween(
    ms / fx.speed,
    (t) => trail.forEach((o, i) => o.position.copy(hop(from, to, height, Math.max(0, t - i * 0.06)))),
    () => {
      for (const o of trail) dispose(o)
      done?.()
    },
  )
}

/** A ring of light spreading on the ground: a scan, a door, a deal. */
export function burst(fx: Fx, at: THREE.Vector3, colour: number, ms = 900, size = 1.6) {
  const ring = new THREE.Mesh(
    RING,
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.copy(at).setY(0.08)
  fx.root.add(ring)
  fx.clock.tween(
    ms / fx.speed,
    (t) => {
      ring.scale.setScalar(0.2 + t * size)
      ring.material.opacity = 1 - t
    },
    () => dispose(ring),
  )
}

/** Words that rise and fade over a spot. */
export function floatText(fx: Fx, at: THREE.Vector3, text: string, tone: "money" | "warn" | "info", ms = 1800) {
  const div = document.createElement("div")
  div.className = "ft-float"
  div.dataset.tone = tone
  div.textContent = text
  const label = new CSS2DObject(div)
  label.center.set(0.5, 1)
  label.position.copy(at).setY(at.y + 1)
  fx.root.add(label)
  fx.clock.tween(
    ms / fx.speed,
    (t) => {
      label.position.y = at.y + 1 + t * 1.2
      div.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3)
    },
    () => dispose(label),
  )
}

/** A crate carried from a stall to a building or a truck. */
export function crate(fx: Fx, from: THREE.Vector3, to: THREE.Vector3) {
  const box = new THREE.Mesh(CRATE, new THREE.MeshStandardMaterial({ color: 0xa8763f, roughness: 0.8 }))
  box.castShadow = true
  fx.root.add(box)
  fx.clock.tween(
    1200 / fx.speed,
    (t) => {
      box.position.copy(hop(from, to, 0.8, t))
      box.rotation.y = t * Math.PI
    },
    () => dispose(box),
  )
}

/** A cold light that swells and dies away (the vault door opening). */
export function flare(fx: Fx, at: THREE.Vector3, colour: number, ms = 1600) {
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  glow.position.copy(at).setY(0.8)
  fx.root.add(glow)
  fx.clock.tween(
    ms / fx.speed,
    (t) => {
      glow.material.opacity = Math.sin(Math.PI * t) * 0.35
      glow.scale.setScalar(0.4 + t * 1.6)
    },
    () => dispose(glow),
  )
}

/** A column of light that rises, holds and fades over a place: a vault booked, a lot sold. */
export function pillar(fx: Fx, at: THREE.Vector3, colour: number, ms = 2600) {
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.7, 10, 20, 1, true).translate(0, 5, 0),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  )
  column.position.copy(at).setY(0)
  fx.root.add(column)
  fx.clock.tween(
    ms / fx.speed,
    (t) => {
      column.material.opacity = Math.sin(Math.PI * t) * 0.45
      column.scale.set(1, 0.3 + Math.min(1, t * 3) * 0.7, 1)
    },
    () => {
      column.geometry.dispose()
      dispose(column)
    },
  )
}

type Weather = { group: THREE.Group; tick?: (t: number) => void }

/**
 * Weather, festivals, plaques and price weather over the buildings. One of each per place: a new one
 * replaces the old; "quiet" clears it.
 */
export class Sky3D {
  private readonly weather = new Map<string, Weather>()
  private readonly plaques = new Map<string, CSS2DObject>()
  private tints: THREE.Group | undefined

  constructor(
    private readonly root: THREE.Object3D,
    private readonly clock: Clock,
  ) {}

  private chip(text: string, cls: string, at: THREE.Vector3, tone?: string) {
    const div = document.createElement("div")
    div.className = cls
    if (tone) div.dataset.tone = tone
    const { title, subtitle } = splitSign(text)
    const head = document.createElement("strong")
    head.textContent = title
    div.append(head)
    if (subtitle) {
      const sub = document.createElement("span")
      sub.textContent = subtitle
      div.append(sub)
    }
    const label = new CSS2DObject(div)
    label.center.set(0.5, 1)
    label.position.copy(at)
    return label
  }

  private set(key: string, w: Weather | undefined) {
    const old = this.weather.get(key)
    if (old) dispose(old.group)
    if (w) {
      this.root.add(w.group)
      this.weather.set(key, w)
    } else this.weather.delete(key)
  }

  /** A storm over a place: a low cloud with lightning in it, and the forecast. */
  storm(key: string, roof: THREE.Vector3, label: string) {
    const group = new THREE.Group()
    group.position.set(roof.x, 0, roof.z)
    const cloud = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e3547, roughness: 1, transparent: true, opacity: 0.94 })
    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Mesh(ORB, mat)
      puff.scale.setScalar(0.8 + (i % 3) * 0.3)
      puff.position.set((i - 3) * 0.75, roof.y + 3.2 + Math.sin(i * 2.1) * 0.3, Math.cos(i * 1.7) * 0.5)
      cloud.add(puff)
    }
    const bolt = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xc7d2fe,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    bolt.position.set(0, roof.y + 2.6, 0)
    group.add(cloud, bolt, this.chip(label, "ft-weather", new THREE.Vector3(0, roof.y, 0), "storm"))
    this.set(key, {
      group,
      tick: (t) => {
        cloud.position.x = Math.sin(t / 2400) * 0.4
        // A flash every few seconds: two quick strikes.
        const k = (t / 1000) % 4.2
        bolt.material.opacity = k < 0.08 || (k > 0.18 && k < 0.24) ? 0.45 : 0
      },
    })
  }

  quiet(key: string, roof: THREE.Vector3, label: string) {
    this.set(key, undefined)
    const group = new THREE.Group()
    group.position.set(roof.x, 0, roof.z)
    group.add(this.chip(label, "ft-weather", new THREE.Vector3(0, roof.y, 0), "quiet"))
    this.set(key, { group })
    this.clock.after(5000, () => {
      if (this.weather.get(key)?.group === group) this.set(key, undefined)
    })
  }

  /** A festival: strings of coloured lights circling over the place, and its name. */
  festival(key: string, roof: THREE.Vector3, label: string) {
    const group = new THREE.Group()
    group.position.set(roof.x, 0, roof.z)
    const lights = new THREE.Group()
    const colours = [0xffc857, 0xff7ab6, 0xc6ff2e, 0x3fd8ff, 0xa78bfa]
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2
      const o = glowOrb(colours[i % colours.length]!, 0.08)
      o.position.set(Math.cos(a) * 3, roof.y + 0.8 + Math.sin(a * 3) * 0.25, Math.sin(a) * 3)
      lights.add(o)
    }
    group.add(lights, this.chip(label, "ft-weather", new THREE.Vector3(0, roof.y, 0), "festival"))
    this.set(`festival:${key}`, { group, tick: (t) => (lights.rotation.y = t / 4000) })
  }

  plaque(key: string, roof: THREE.Vector3, text: string) {
    const old = this.plaques.get(key)
    if (old) dispose(old)
    const chip = this.chip(text, "ft-plaque", roof.clone())
    this.root.add(chip)
    this.plaques.set(key, chip)
  }

  /** Price weather: each market's ground glows in its band's colour; null clears it. */
  priceWeather(spots: { colour: number; x: number; z: number; w: number; d: number }[] | null) {
    if (this.tints) dispose(this.tints)
    this.tints = undefined
    if (!spots) return
    const group = new THREE.Group()
    for (const s of spots) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(s.w, s.d).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: s.colour,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      plate.position.set(s.x, 0.06, s.z)
      group.add(plate)
    }
    this.root.add(group)
    this.tints = group
  }

  tick(t: number, still: boolean) {
    if (still) return
    for (const w of this.weather.values()) w.tick?.(t)
  }
}
