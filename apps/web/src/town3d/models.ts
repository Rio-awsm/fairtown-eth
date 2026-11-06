import * as THREE from "three"
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js"
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js"
import { clayTone, fitScale, isGlass } from "./look"
import { LOOKS, type SceneLook } from "./theme"

const BASE = "/assets/models/kenney/"

/**
 * How a model is dressed. "clay": graphite clay with glowing windows (buildings). "keep": its own
 * paint, made physically lit (cars, boats, containers, people). "foliage": dark night leaves.
 */
export type Look = "clay" | "keep" | "foliage"
export type Space = { w?: number; d?: number; h?: number }

type Entry = { gltf: GLTF | null; size: THREE.Vector3; offset: THREE.Vector3 }
type Part = { geometry: THREE.BufferGeometry; material: THREE.Material }

const STAND_IN = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)

/** Window light, from dark to bright: buildings pick one, so the town never looks switched on at once. */
export const WINDOW_LEVELS = [0.08, 0.45, 0.85, 1.25] as const

/**
 * The town's model library: loads Kenney's CC0 glTF models once, then hands out fitted copies.
 * A model that fails to load becomes a clay box, and its name goes in `failed`, so a missing file
 * never stops the town.
 */
export class Models {
  readonly failed: string[] = []
  private readonly entries = new Map<string, Entry>()
  private readonly loader = new GLTFLoader()
  private readonly clayCache = new Map<THREE.Texture, { clay: THREE.Texture; glass: THREE.Texture }>()
  private readonly materials = new Map<string, THREE.Material>()
  private look: SceneLook = LOOKS.night

  constructor(private readonly base = BASE) {}

  async load(keys: readonly string[]): Promise<void> {
    await Promise.all(
      [...new Set(keys)]
        .filter((k) => !this.entries.has(k))
        .map(async (key) => {
          let gltf: GLTF | null = null
          try {
            gltf = await this.loader.loadAsync(`${this.base}${key}.glb`)
          } catch (error: unknown) {
            console.warn(`could not load model ${key}; drawing a stand-in`, error)
            this.failed.push(key)
          }
          const box = gltf
            ? new THREE.Box3().setFromObject(gltf.scene)
            : new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
          const size = box.getSize(new THREE.Vector3())
          const centre = box.getCenter(new THREE.Vector3())
          this.entries.set(key, { gltf, size, offset: new THREE.Vector3(-centre.x, -box.min.y, -centre.z) })
        }),
    )
  }

  animations(key: string): THREE.AnimationClip[] {
    return this.entries.get(key)?.gltf?.animations ?? []
  }

  /** The scale that fits a model into a space. */
  scaleFor(key: string, space: Space): number {
    const e = this.entries.get(key)
    return e ? fitScale(e.size, space) : 1
  }

  /** A fitted copy standing on y = 0, centred on its own origin. Skinned models clone their skeleton. */
  make(key: string, look: Look, space: Space, lit = 1): THREE.Object3D {
    const e = this.entries.get(key)
    const holder = new THREE.Group()
    if (!e?.gltf) {
      const box = new THREE.Mesh(STAND_IN, this.clay(null, 0))
      box.scale.set(space.w ?? space.h ?? 1, space.h ?? Math.min(space.w ?? 1, space.d ?? 1), space.d ?? space.w ?? 1)
      holder.add(box)
      return holder
    }
    const copy = SkeletonUtils.clone(e.gltf.scene)
    copy.position.copy(e.offset)
    copy.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.material = this.dress(o.material as THREE.Material, look, lit)
      o.castShadow = look !== "keep" || !(o instanceof THREE.SkinnedMesh)
      o.receiveShadow = true
    })
    const s = fitScale(e.size, space)
    const inner = new THREE.Group()
    inner.add(copy)
    inner.scale.setScalar(s)
    holder.add(inner)
    return holder
  }

  /**
   * The model's meshes as geometry in its own normalised space (standing on y = 0, centred), for
   * instancing many copies (trees, homes, containers). Skinned models are not instanced.
   */
  parts(key: string, look: Look, lit = 1): Part[] {
    const e = this.entries.get(key)
    if (!e?.gltf) return [{ geometry: STAND_IN, material: this.clay(null, 0) }]
    const out: Part[] = []
    e.gltf.scene.updateMatrixWorld(true)
    const shift = new THREE.Matrix4().makeTranslation(e.offset.x, e.offset.y, e.offset.z)
    e.gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) return
      const geometry = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(shift.clone().multiply(o.matrixWorld))
      out.push({ geometry, material: this.dress(o.material as THREE.Material, look, lit) })
    })
    return out
  }

  sizeOf(key: string): THREE.Vector3 {
    return this.entries.get(key)?.size.clone() ?? new THREE.Vector3(1, 1, 1)
  }

  private dress(original: THREE.Material, look: Look, lit: number): THREE.Material {
    const src = original as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial
    if (look === "clay") return this.clay(src.map ?? null, lit)
    if (look === "foliage") {
      const id = `foliage:${src.uuid}`
      let m = this.materials.get(id)
      if (!m) {
        // Night leaves: the kit's green, darkened and pulled towards slate.
        const c = (src.color ?? new THREE.Color(0x2f5d3a))
          .clone()
          .lerp(new THREE.Color(0x1a2430), 0.6)
          .multiplyScalar(0.5)
        m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0 })
        m.userData = { kind: "leaves", base: c.clone() }
        this.relook(m)
        this.materials.set(id, m)
      }
      return m
    }
    const id = `keep:${src.uuid}`
    let m = this.materials.get(id)
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        map: src.map ?? null,
        // Paint at night: the same colours, a little muted, so they sit in the clay town.
        color: (src.color ?? new THREE.Color(0xffffff)).clone().multiplyScalar(0.72),
        roughness: 0.55,
        metalness: 0.08,
      })
      m.userData = { kind: "paint", base: (m as THREE.MeshStandardMaterial).color.clone() }
      this.relook(m)
      this.materials.set(id, m)
    }
    return m
  }

  /** Graphite clay from a palette texture, with its glass glowing warm at `lit` strength. */
  private clay(map: THREE.Texture | null, lit: number): THREE.Material {
    const id = `clay:${map?.uuid ?? "none"}:${lit}`
    let m = this.materials.get(id)
    if (m) return m
    const tex = map ? this.clayTextures(map) : null
    m = new THREE.MeshStandardMaterial({
      color: tex ? 0xffffff : 0x3f4659,
      map: tex?.clay ?? null,
      emissive: lit > 0 ? 0xffb35c : 0x000000,
      emissiveMap: tex?.glass ?? null,
      emissiveIntensity: lit,
      roughness: 0.82,
      metalness: 0.02,
    })
    m.userData = { kind: "clay", base: (m as THREE.MeshStandardMaterial).color.clone(), lit }
    this.relook(m)
    this.materials.set(id, m)
    return m
  }

  /** Day or night (D-122): every building, car, person and tree takes the look, now and when made. */
  setLook(look: SceneLook): void {
    this.look = look
    for (const m of this.materials.values()) this.relook(m)
  }

  private relook(m: THREE.Material) {
    const d = m.userData as { kind?: "clay" | "paint" | "leaves"; base?: THREE.Color; lit?: number }
    if (!d.kind || !d.base || !(m instanceof THREE.MeshStandardMaterial)) return
    const k = d.kind === "clay" ? this.look.clay : d.kind === "paint" ? this.look.paint : this.look.leaves
    m.color.copy(d.base).multiplyScalar(k)
    if (d.kind === "clay") m.emissiveIntensity = (d.lit ?? 0) * this.look.windows
  }

  private clayTextures(map: THREE.Texture): { clay: THREE.Texture; glass: THREE.Texture } {
    const hit = this.clayCache.get(map)
    if (hit) return hit
    const img = map.image as CanvasImageSource & { width: number; height: number }
    const w = img.width || 512
    const h = img.height || 512
    const read = document.createElement("canvas")
    read.width = w
    read.height = h
    const g = read.getContext("2d", { willReadFrequently: true })
    const clay = document.createElement("canvas")
    const glass = document.createElement("canvas")
    clay.width = glass.width = w
    clay.height = glass.height = h
    if (g) {
      g.drawImage(img, 0, 0)
      const px = g.getImageData(0, 0, w, h)
      const c = new ImageData(w, h)
      const e = new ImageData(w, h)
      for (let i = 0; i < px.data.length; i += 4) {
        const r = px.data[i]!
        const gg = px.data[i + 1]!
        const b = px.data[i + 2]!
        const glassy = isGlass(r, gg, b)
        const [cr, cg, cb] = glassy ? [22, 28, 44] : clayTone(r, gg, b)
        c.data.set([cr, cg, cb, 255], i)
        e.data.set(glassy ? [255, 255, 255, 255] : [0, 0, 0, 255], i)
      }
      clay.getContext("2d")?.putImageData(c, 0, 0)
      glass.getContext("2d")?.putImageData(e, 0, 0)
    }
    const wrap = (cv: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(cv)
      t.flipY = map.flipY
      // Kenney models use KHR_texture_transform: keep each texture's offset, repeat and rotation.
      t.offset.copy(map.offset)
      t.repeat.copy(map.repeat)
      t.center.copy(map.center)
      t.rotation = map.rotation
      t.wrapS = map.wrapS
      t.wrapT = map.wrapT
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      t.magFilter = THREE.NearestFilter
      t.minFilter = THREE.NearestMipmapLinearFilter
      return t
    }
    const out = { clay: wrap(clay, true), glass: wrap(glass, true) }
    this.clayCache.set(map, out)
    return out
  }
}
