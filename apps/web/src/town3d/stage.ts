import * as THREE from "three"
import { HDRLoader } from "three/addons/loaders/HDRLoader.js"
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"
import { ndcToCanvas } from "./coords"
import { buildPost, type Post } from "./post"
import { LOOKS, type SceneLook } from "./theme"

/** The camera looks down at this angle, from the south, like a miniature on a table. */
export const ELEVATION = THREE.MathUtils.degToRad(42)
export const AZIMUTH = THREE.MathUtils.degToRad(24)
const FOV = 26
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
/** Backbuffer scale for software WebGL. */
const LOW_PIXEL_RATIO = 0.5
const HDRI_URL = "/assets/env/moonless_golf_1k.hdr"

export type Quality = "high" | "low"

/**
 * One step of dynamic resolution, checked once a second: under 50 fps, draw 10% smaller (not
 * below 60%); above 57 fps for three checks running, 10% larger (not above full size).
 */
export function adaptScale(scale: number, fps: number, calm: number): { scale: number; calm: number } {
  if (fps < 50) return { scale: Math.max(0.6, Math.round((scale - 0.1) * 10) / 10), calm: 0 }
  if (fps > 57) {
    if (calm + 1 >= 3 && scale < 1) return { scale: Math.min(1, Math.round((scale + 0.1) * 10) / 10), calm: 0 }
    return { scale, calm: calm + 1 }
  }
  return { scale, calm: 0 }
}

/** Software WebGL (headless browsers, some VMs): draw lighter so the frame rate stays honest. */
export function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  const info = gl.getExtension("WEBGL_debug_renderer_info")
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ""
  return /swiftshader|llvmpipe|software/i.test(name) ? "low" : "high"
}

/** Asks a throwaway context which GPU is behind WebGL, before the real renderer is made. */
export function probeQuality(): Quality {
  try {
    const gl =
      document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl")
    if (!gl) return "low"
    const quality = detectQuality(gl)
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return quality
  } catch (error: unknown) {
    console.warn("could not probe WebGL, drawing light", error)
    return "low"
  }
}

/**
 * Renderer, scene, camera rig, night light, post chain and the label layer, with a frame loop.
 * The rig is a ground point (x, z) and a zoom: 1× frames the whole map, higher is closer.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 3000)
  readonly labels = new CSS2DRenderer()
  readonly quality: Quality
  readonly rig = { x: 0, z: 0, zoom: 1 }
  /** Screen pixels the HUD covers at the top and bottom; the whole-town view fits between them. */
  insets = { top: 0, bottom: 0 }
  /** The look-at point that frames the whole map at 1×. */
  home = { x: 0, z: 0 }
  private post!: Post
  private fitDistance = 60
  private bounds = { w: 60, d: 34 }
  private framed = false
  private raf = 0
  private last = 0
  private fpsAvg = 60
  private readonly frames = new Set<(t: number, dt: number) => void>()
  private readonly resizer: ResizeObserver
  private readonly raycaster = new THREE.Raycaster()
  private readonly hemi: THREE.HemisphereLight
  private readonly fill: THREE.DirectionalLight
  private readonly moon: THREE.DirectionalLight
  private look: SceneLook = LOOKS.night

  constructor(private readonly host: HTMLElement) {
    // ?quality=low|high overrides the guess (a weak projector laptop, or checking the light mode).
    const asked = new URLSearchParams(window.location.search).get("quality")
    const probed = asked === "low" || asked === "high" ? asked : probeQuality()
    // Software WebGL: no multisampling and a smaller backbuffer, so the page stays responsive.
    this.renderer = new THREE.WebGLRenderer({ antialias: probed === "high", powerPreference: "high-performance" })
    this.quality = asked === "high" ? "high" : probed === "low" ? "low" : detectQuality(this.renderer.getContext())
    this.renderer.setPixelRatio(this.quality === "high" ? Math.min(2, window.devicePixelRatio) : LOW_PIXEL_RATIO)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = this.quality === "high"
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Only still things cast shadows (buildings, trees, stalls): redraw the map when they change.
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.domElement.style.display = "block"
    host.appendChild(this.renderer.domElement)
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" })
    host.appendChild(this.labels.domElement)

    this.scene.background = new THREE.Color(LOOKS.night.sky)
    this.scene.fog = new THREE.Fog(LOOKS.night.sky, 90, 220)
    this.hemi = new THREE.HemisphereLight(LOOKS.night.hemiSky, LOOKS.night.hemiGround, LOOKS.night.hemi)
    this.scene.add(this.hemi)
    // A cool fill from the camera's side, so the faces we look at never go black.
    const fill = new THREE.DirectionalLight(0x5b78c2, LOOKS.night.fill)
    fill.position.set(30, 40, 80)
    this.scene.add(fill)
    this.fill = fill
    const moon = new THREE.DirectionalLight(LOOKS.night.keyColour, LOOKS.night.key)
    moon.castShadow = this.quality === "high"
    moon.shadow.mapSize.set(2048, 2048)
    moon.shadow.bias = -0.0004
    moon.shadow.normalBias = 0.02
    this.scene.add(moon, moon.target)
    this.moon = moon
    this.post = buildPost(this.renderer, this.scene, this.camera)
    this.setLook(LOOKS.night)
    this.resizer = new ResizeObserver(() => this.resize())
    this.resizer.observe(host)
    this.resize()
  }

  /** The night sky from a real HDRI, for what reflects it (water); null until loaded or in light mode. */
  envMap: THREE.Texture | null = null

  /**
   * Night sky light from a real HDRI. Only reflective surfaces take it: lighting every material
   * with it cost about a fifth of the frame for little difference on clay.
   */
  async loadEnvironment(): Promise<void> {
    if (this.quality === "low") return
    try {
      const hdr = await new HDRLoader().loadAsync(HDRI_URL)
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this.envMap = pmrem.fromEquirectangular(hdr).texture
      hdr.dispose()
      pmrem.dispose()
    } catch (error: unknown) {
      console.warn(`could not load ${HDRI_URL}; lighting without it`, error)
    }
  }

  /** Day or night (D-122): sky, fog, light, exposure, bloom and vignette. */
  setLook(look: SceneLook): void {
    this.look = look
    ;(this.scene.background as THREE.Color).setHex(look.sky)
    this.scene.fog?.color.setHex(look.sky)
    this.hemi.color.setHex(look.hemiSky)
    this.hemi.groundColor.setHex(look.hemiGround)
    this.hemi.intensity = look.hemi
    this.fill.intensity = look.fill
    this.moon.color.setHex(look.keyColour)
    this.moon.intensity = look.key
    this.renderer.toneMappingExposure = look.exposure
    this.post.setLook(look)
  }

  get currentLook(): SceneLook {
    return this.look
  }

  /** Something that casts a shadow appeared, moved or went: redraw the shadow map once. */
  shadowsChanged(): void {
    this.renderer.shadowMap.needsUpdate = true
  }

  get fit(): number {
    return this.fitDistance
  }

  /** Fit the rig to a map of w × d world units: 1× zoom shows all of it, between the HUD insets. */
  frame(w: number, d: number): void {
    this.bounds = { w, d }
    const half = Math.max(w, d) * 0.62
    this.moon.target.position.set(w / 2, 0, d / 2)
    this.moon.position.set(w / 2 - 28, 70, d / 2 - 36)
    Object.assign(this.moon.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 200 })
    this.moon.shadow.camera.updateProjectionMatrix()
    const corners = [
      [0, 0],
      [w, 0],
      [0, d],
      [w, d],
    ].map(([x, z]) => new THREE.Vector3(x!, 0, z!))
    const h = Math.max(1, this.host.clientHeight)
    const room = 2 * Math.max(0.3, 1 - (this.insets.top + this.insets.bottom) / h)
    const fits = (dist: number) => {
      this.fitDistance = dist
      this.rig.zoom = 1
      this.rig.x = w / 2
      this.rig.z = d / 2
      this.place(this.rig.x, this.rig.z, dist)
      // The camera looks down on the ground from above, so every corner is in front of it.
      const ps = corners.map((c) => c.clone().project(this.camera))
      const spanX = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x))
      const spanY = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y))
      return spanX <= 1.96 && spanY <= room - 0.04
    }
    let lo = 1
    let hi = 2000
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    fits(hi)
    // Shift the look-at point so the corners' bounding box sits in the middle of the free view.
    const ps = corners.map((c) => c.clone().project(this.camera))
    const centre = new THREE.Vector2(
      (Math.max(...ps.map((p) => p.x)) + Math.min(...ps.map((p) => p.x))) / 2,
      (Math.max(...ps.map((p) => p.y)) + Math.min(...ps.map((p) => p.y))) / 2 -
        (this.insets.bottom - this.insets.top) / h,
    )
    this.raycaster.setFromCamera(centre, this.camera)
    const hit = new THREE.Vector3()
    this.home = this.raycaster.ray.intersectPlane(GROUND, hit) ? { x: hit.x, z: hit.z } : { x: w / 2, z: d / 2 }
    this.rig.x = this.home.x
    this.rig.z = this.home.z
    this.fitDistance = hi
    this.framed = true
    this.apply()
  }

  /** Place the camera from the rig, keeping the view's centre within the map as it zooms in. */
  apply(): void {
    const z = Math.max(1, this.rig.zoom)
    const k = 1 - 1 / z
    this.rig.x = THREE.MathUtils.clamp(
      this.rig.x,
      this.home.x * (1 - k),
      this.home.x + (this.bounds.w - this.home.x) * k,
    )
    this.rig.z = THREE.MathUtils.clamp(
      this.rig.z,
      this.home.z * (1 - k),
      this.home.z + (this.bounds.d - this.home.z) * k,
    )
    this.place(this.rig.x, this.rig.z, this.fitDistance / z)
  }

  private place(x: number, z: number, dist: number) {
    this.camera.position.set(
      x + Math.sin(AZIMUTH) * Math.cos(ELEVATION) * dist,
      Math.sin(ELEVATION) * dist,
      z + Math.cos(AZIMUTH) * Math.cos(ELEVATION) * dist,
    )
    this.camera.lookAt(x, 0, z)
    this.camera.updateMatrixWorld()
    const fog = this.scene.fog as THREE.Fog
    fog.near = dist * 1.1
    fog.far = dist * 2.6
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.post.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // The fit depends on the view's shape: redo it, keeping the zoom and centre.
    if (this.framed) {
      const keep = { ...this.rig }
      this.frame(this.bounds.w, this.bounds.d)
      Object.assign(this.rig, keep)
      this.apply()
    }
  }

  onFrame(fn: (t: number, dt: number) => void): () => void {
    this.frames.add(fn)
    return () => this.frames.delete(fn)
  }

  get fps(): number {
    return this.fpsAvg
  }

  /** The base pixel ratio, and how much of it is drawn now (dynamic resolution). */
  private baseRatio = 1
  private scale = 1
  private nextCheck = 0
  private calm = 0

  /**
   * Dynamic resolution: when the frame rate falls under 50, draw the 3D image a little smaller
   * (down to 60%); when there is room again, climb back. Labels and the HUD are DOM, so they stay
   * sharp. The frame rate stays honest on a busy town or a weaker demo laptop.
   */
  private adapt(t: number) {
    if (this.quality !== "high" || t < this.nextCheck) return
    this.nextCheck = t + 1000
    const next = adaptScale(this.scale, this.fpsAvg, this.calm)
    this.calm = next.calm
    if (next.scale === this.scale) return
    this.scale = next.scale
    const ratio = this.baseRatio * this.scale
    this.renderer.setPixelRatio(ratio)
    this.post.composer.setPixelRatio(ratio)
    this.resize()
  }

  start(still: boolean): void {
    this.baseRatio = this.renderer.getPixelRatio()
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop)
      const dt = this.last ? Math.min(100, t - this.last) : 16
      this.last = t
      if (dt > 0) this.fpsAvg += (1000 / dt - this.fpsAvg) * 0.05
      this.adapt(t)
      for (const fn of this.frames) fn(t, dt)
      this.apply()
      this.post.tick(t, still)
      // Low quality draws straight to the screen: the bloom chain alone costs more than the town.
      if (this.quality === "high") this.post.composer.render()
      else this.renderer.render(this.scene, this.camera)
      this.labels.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  ndc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  }

  /** The point on the ground under a client point, in world units. */
  ground(clientX: number, clientY: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera)
    const hit = new THREE.Vector3()
    return this.raycaster.ray.intersectPlane(GROUND, hit)
  }

  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | undefined {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera)
    return this.raycaster.intersectObjects(objects, true)[0]
  }

  /** Where a world point lands on the 1920 × 1080 canvas space. */
  toCanvas(p: THREE.Vector3): { x: number; y: number } {
    return ndcToCanvas(p.clone().project(this.camera))
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizer.disconnect()
    this.post.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }
}
