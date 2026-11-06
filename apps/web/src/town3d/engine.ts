import type { Building } from "@fairtown/shared/keys"
import * as THREE from "three"
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"
import { BAND_COLOUR } from "../arkiv/weather"
import { env } from "../config"
import { townStore } from "../state/townStore"
import { EventBus, type AgentProbe, type SceneProbe } from "../game/EventBus"
import {
  buildRoadGrid,
  buildWalkGrid,
  centreOf,
  createPathfinder,
  isWalkable,
  nearestWalkable,
  tileOf,
  type Pathfinder,
  type WalkGrid,
} from "../game/agents/pathing"
import { QueueAllocator } from "../game/agents/queue"
import { AgentRoster } from "../game/agents/roster"
import type { TownCommand } from "../game/commands"
import { focusFor } from "../game/director"
import {
  MARKET_BUILDINGS,
  anchorFor,
  parseTownMap,
  type MarketBuilding,
  type Point,
  type TownMap,
} from "../game/map/anchors"
import { BUILDING_SIGNS } from "../game/map/buildings"
import { footprintOf, layoutScenery } from "../game/map/scenery"
import { buildStubMap } from "../game/map/stub-map"
import type { TiledMap } from "../game/map/tiled"
import { StallSlots, placeBuilding } from "../game/market/slots"
import { glideAt, splitSign } from "../game/scenes/layout"
import { stressCommands, stressWalk } from "../game/stress"
import { buildCity, CITY_MODELS, type City } from "./city"
import { Clock } from "./clock"
import { declutter, nearestStep, nextStep, zoomBy } from "./declutter"
import { TILE_PX } from "./coords"
import { Sky3D, arc, burst, crate, flare, floatText, type Fx } from "./fx"
import { Models } from "./models"
import { Agent3D, PEOPLE, STEP_MS, polyline } from "./people"
import { Stage } from "./stage"
import { STALL_MODELS, Stall3D } from "./stall"

const MAP_URL = "/assets/maps/town.tmj"
const MAX_AGENTS = 80
const CARS = ["car/sedan", "car/suv", "car/taxi", "car/van"] as const
/** A director close-up, relative to the whole-town view (as in the 2D town). */
const FOCUS_ZOOM = 1.6

const w3 = (p: Point, y = 0) => new THREE.Vector3(p.x / TILE_PX, y, p.y / TILE_PX)

type Car = { mesh: THREE.Object3D; x: number; y: number; stop: () => void }

/**
 * The 3D town (D-113): Kenney's CC0 models in the landing's night look, driven by reducer
 * commands. Agents walk and talk, stalls glow and clear, money hops between them, trucks drive.
 * The reducer, commands, EventBus and the __TOWN__ probe are the same as for the 2D town.
 */
export class TownEngine {
  readonly stage: Stage
  readonly models = new Models()
  private readonly clock = new Clock()
  private readonly world = new THREE.Group()
  private town!: TownMap
  private walkGrid!: WalkGrid
  private roadGrid!: WalkGrid
  private people!: Pathfinder
  private roads!: Pathfinder
  private city!: City
  private sky!: Sky3D
  private readonly queue = new QueueAllocator(8)
  private readonly roster = new AgentRoster(MAX_AGENTS)
  private readonly pool: Agent3D[] = []
  private readonly agents = new Map<string, Agent3D>()
  private readonly trucks = new Map<string, Car>()
  private readonly traffic: Car[] = []
  private readonly stalls = new Map<string, Stall3D>()
  private readonly slots = new StallSlots()
  private readonly seen = new Map<string, number>()
  private readonly sellerTier = new Map<string, "new" | "proven">()
  private readonly lotBuilding = new Map<string, Building>()
  private readonly offs: (() => void)[] = []
  private readonly toast: HTMLDivElement
  private block = 0
  private speed = 1
  private still = false
  private focusUntil = 0
  private stopFocus: (() => void) | undefined
  private stopGlide: (() => void) | undefined
  /** A person who just zoomed or dragged keeps the camera: the director waits until then. */
  private manualUntil = 0
  private disposed = false
  /** Commands that arrive while models load: played once the town is built, so nothing is lost. */
  private early: TownCommand[] | null = []

  constructor(private readonly host: HTMLElement) {
    this.stage = new Stage(host)
    // The /town HUD: the top bar and the ticker along the bottom.
    this.stage.insets = { top: 150, bottom: 64 }
    this.stage.scene.add(this.world)
    const params = new URLSearchParams(window.location.search)
    this.still =
      (env.exposeTown && (params.has("until") || params.get("relay") === "off")) ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    this.speed = Math.max(1, Number(params.get("speed")) || 1)
    if (params.get("demo") === "1") host.classList.add("ft-town-demo")
    // Headlines (money moved, warnings) sit in the open sky right of the HUD windows.
    this.toast = document.createElement("div")
    this.toast.className = "ft-town-toast"
    this.toast.setAttribute("role", "status")
    host.appendChild(this.toast)
    this.offs.push(
      EventBus.on("town:commands", (commands) => {
        if (this.early) this.early.push(...commands)
        else this.apply(commands)
      }),
    )
    void this.load().catch((error: unknown) => console.error("the 3D town failed to start", error))
  }

  private async load() {
    let raw: unknown
    const problems: string[] = []
    try {
      const res = await fetch(MAP_URL)
      raw = res.ok ? await res.json() : undefined
    } catch (error: unknown) {
      console.warn(`could not load ${MAP_URL}`, error)
    }
    if (raw === undefined) problems.push(`could not load ${MAP_URL}`)
    let parsed = parseTownMap(raw)
    let map = raw as TiledMap
    if (!parsed.ok) {
      // A broken map must not stop the demo: use the stub layout, show and log what is wrong.
      if (problems.length === 0) problems.push(...parsed.problems)
      console.error("Town map problems, using the fallback layout:", problems)
      map = buildStubMap()
      parsed = parseTownMap(map)
      if (!parsed.ok) throw new Error(`fallback map is invalid: ${parsed.problems.join("; ")}`)
    }
    await Promise.all([
      this.models.load([...CITY_MODELS, ...PEOPLE, ...STALL_MODELS, ...CARS]),
      this.stage.loadEnvironment(),
    ])
    if (this.disposed) return
    // A missing model draws as a stand-in; the town still runs, and says what is missing.
    problems.push(...this.models.failed.map((k) => `could not load model ${k}`))
    this.begin(parsed.value, map, problems)
  }

  private begin(town: TownMap, raw: TiledMap, problems: string[]) {
    this.town = town
    this.walkGrid = buildWalkGrid(raw)
    this.roadGrid = buildRoadGrid(raw)
    this.people = createPathfinder(this.walkGrid)
    this.roads = createPathfinder(this.roadGrid)
    this.city = buildCity(
      this.models,
      town,
      raw,
      this.walkGrid,
      this.roadGrid,
      layoutScenery(town, this.walkGrid, this.roadGrid),
    )
    this.world.add(this.city.group)
    // The night sky shows in what reflects it.
    if (this.stage.envMap)
      this.city.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (m?.userData?.reflective) m.envMap = this.stage.envMap
      })
    this.stage.frame(town.widthPx / TILE_PX, town.heightPx / TILE_PX)
    this.sky = new Sky3D(this.world, this.clock)
    this.signs()
    this.gate()
    if (problems.length > 0) this.showProblems(problems)
    if (!this.still) this.startTraffic()
    this.stage.shadowsChanged()
    this.stage.onFrame((t, dt) => this.frame(t, dt))
    this.stage.start(this.still)
    this.controls()
    this.declutterLabels()

    // What happened while the models loaded plays now, before the store sends the current state.
    const early = this.early ?? []
    this.early = null
    if (early.length > 0) this.apply(early)
    this.offs.push(
      EventBus.on("priceWeather", (bands) => {
        if (bands) this.see("priceWeather")
        this.sky.priceWeather(
          bands &&
            MARKET_BUILDINGS.flatMap((b) => {
              const band = bands[b]
              if (!band) return []
              const f = footprintOf(this.town, b)
              return [
                {
                  colour: BAND_COLOUR[band],
                  x: (f.x + f.w / 2) / TILE_PX,
                  z: (f.y + f.h / 2) / TILE_PX,
                  w: f.w / TILE_PX + 2,
                  d: f.h / TILE_PX + 2,
                },
              ]
            }),
        )
      }),
      EventBus.on("camera:jump", (b) => this.focus(b as Building, 6000, true)),
      // Keep the selected agent's name tag up while its panel is open.
      townStore.subscribe((s, prev) => {
        if (s.selection === prev.selection) return
        if (prev.selection?.kind === "agent") this.agents.get(prev.selection.id)?.setSelected(false)
        if (s.selection?.kind === "agent") this.agents.get(s.selection.id)?.setSelected(true)
      }),
      // Turning the director off sends the camera straight home.
      townStore.subscribe((s, prev) => {
        if (prev.ui.director && !s.ui.director) this.home()
      }),
    )
    const fps = window.setInterval(() => EventBus.emit("scene:fps", Math.round(this.stage.fps * 10) / 10), 500)
    this.offs.push(() => window.clearInterval(fps))
    EventBus.emit("scene:probe", () => this.probe())
    EventBus.emit("map:status", {
      status: problems.length > 0 ? "error" : "ready",
      buildings: MARKET_BUILDINGS.length,
      problems,
    })
    EventBus.emit("scene:ready", undefined)
    if (env.exposeTown && new URLSearchParams(window.location.search).get("stress") === "1") this.startStress()
  }

  private fx(): Fx {
    return { root: this.world, clock: this.clock, speed: this.speed }
  }

  private frame(t: number, dt: number) {
    this.clock.advance(dt)
    this.city.tick(t, this.still)
    for (const a of this.agents.values()) a.tick(t, dt, this.still)
    this.sky.tick(t, this.still)
  }

  /** Each market's name over its roof: a glass chip that opens the building's panel. */
  private signs() {
    for (const b of MARKET_BUILDINGS) {
      const { title, subtitle } = splitSign(BUILDING_SIGNS[b])
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "ft-sign"
      chip.tabIndex = -1
      const head = document.createElement("strong")
      head.textContent = title
      chip.append(head)
      if (subtitle) {
        const sub = document.createElement("span")
        sub.textContent = subtitle
        chip.append(sub)
      }
      chip.addEventListener("pointerdown", (e) => {
        e.stopPropagation()
        EventBus.emit("select", { kind: "building", id: b })
      })
      const label = new CSS2DObject(chip)
      label.center.set(0.5, 1)
      label.position.copy(this.city.roofs[b])
      this.world.add(label)
    }
  }

  /** The town gate: two lit pillars and a beam over the threshold, with its sign. */
  private gate() {
    const at = w3(this.town.anchors.gateSpawn)
    const clay = new THREE.MeshStandardMaterial({ color: 0x3f4659, roughness: 0.8 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffc27a, emissive: 0xffc27a, emissiveIntensity: 3 })
    const g = new THREE.Group()
    for (const dx of [-1.6, 1.6]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.35), clay)
      pillar.position.set(dx, 0.9, 0)
      pillar.castShadow = true
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), lamp)
      head.position.set(dx, 1.95, 0)
      g.add(pillar, head)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 0.3), clay)
    beam.position.y = 1.75
    g.add(beam)
    g.position.set(at.x, 0, at.z + 0.6)
    this.world.add(g)
    const chip = document.createElement("div")
    chip.className = "ft-sign ft-sign-gate"
    chip.textContent = BUILDING_SIGNS.town_gate
    const label = new CSS2DObject(chip)
    label.center.set(0.5, 1)
    label.position.set(at.x, 2.2, at.z + 0.6)
    this.world.add(label)
  }

  private showProblems(problems: string[]) {
    const box = document.createElement("div")
    box.className = "ft-town-problems"
    box.textContent = problems.slice(0, 6).join("\n")
    this.host.appendChild(box)
  }

  // ---------------------------------------------------------------- camera

  private glide(to: THREE.Vector3, zoom: number, ms = 600) {
    this.stopGlide?.()
    const rig = this.stage.rig
    const from = { x: rig.x, z: rig.z, zoom: rig.zoom }
    this.stopGlide = this.clock.tween(
      ms,
      (p) => {
        const t = glideAt(p)
        rig.x = from.x + (to.x - from.x) * t
        rig.z = from.z + (to.z - from.z) * t
        rig.zoom = from.zoom + (zoom - from.zoom) * t
        this.stage.apply()
      },
      () => (this.stopGlide = undefined),
    )
  }

  /** Camera director (S3 5.1): ease to a building, hold, then back to the whole town. */
  private focus(building: Building, holdMs: number, force = false) {
    const now = this.clock.now
    if (!force && (now < this.focusUntil - holdMs / 2 || now < this.manualUntil)) return
    this.glide(w3(anchorFor(this.town.anchors, building)), FOCUS_ZOOM)
    this.focusUntil = now + holdMs
    this.stopFocus?.()
    this.stopFocus = this.clock.after(holdMs, () => this.home())
  }

  private home() {
    this.stopFocus?.()
    this.focusUntil = 0
    this.manualUntil = 0
    this.glide(new THREE.Vector3(this.stage.home.x, 0, this.stage.home.z), 1)
  }

  /** Zoom to a level keeping the ground under a client point where it is on screen. */
  private zoomAt(zoom: number, clientX: number, clientY: number) {
    const before = this.stage.ground(clientX, clientY)
    this.stage.rig.zoom = zoom
    this.stage.apply()
    const after = this.stage.ground(clientX, clientY)
    if (before && after) {
      this.stage.rig.x += before.x - after.x
      this.stage.rig.z += before.z - after.z
      this.stage.apply()
    }
  }

  /**
   * Zoom with the mouse wheel (one step a notch, towards the cursor) or a trackpad scroll or pinch
   * (smooth, then settling on the nearest step); drag to pan when zoomed in; + − 0 on the keyboard.
   * Any of them pauses the camera director for 20 s. Clicks open what is under the pointer.
   */
  private controls() {
    const canvas = this.stage.renderer.domElement
    let hovered: Agent3D | undefined
    let settle: (() => void) | undefined
    let ease: (() => void) | undefined
    let heading = 1
    let easing = false
    const touch = (stopEase = true) => {
      this.manualUntil = this.clock.now + 20_000
      this.stopFocus?.()
      this.stopGlide?.()
      if (stopEase) {
        ease?.()
        easing = false
      }
    }
    const animateTo = (target: number, x: number, y: number, ms: number) => {
      ease?.()
      heading = target
      const from = this.stage.rig.zoom
      if (Math.abs(target - from) < 1e-3) return
      easing = true
      ease = this.clock.tween(
        ms,
        (t) => this.zoomAt(from + (target - from) * (1 - (1 - t) * (1 - t)), x, y),
        () => (easing = false),
      )
    }
    const settleAt = (x: number, y: number) => {
      settle?.()
      settle = this.clock.after(160, () => animateTo(nearestStep(this.stage.rig.zoom), x, y, 180))
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // A mouse wheel clicks in notches (lines, or 100 px): one notch, one step. A trackpad scroll
      // or pinch (ctrl + wheel) sends small deltas: zoom smoothly with it, then settle.
      const notch = !e.ctrlKey && (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50)
      touch(!notch)
      if (notch) {
        const goal = easing ? heading : this.stage.rig.zoom
        return animateTo(nextStep(goal, e.deltaY < 0 ? 1 : -1), e.clientX, e.clientY, 160)
      }
      this.zoomAt(zoomBy(this.stage.rig.zoom, e.deltaY, e.ctrlKey ? 0.012 : 0.004), e.clientX, e.clientY)
      settleAt(e.clientX, e.clientY)
    }
    // Safari sends its own gesture events for a pinch.
    let gestureStart = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      touch()
      gestureStart = this.stage.rig.zoom
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      this.zoomAt(Math.min(6, Math.max(1, gestureStart * g.scale)), g.clientX, g.clientY)
      settleAt(g.clientX, g.clientY)
    }
    const pickables = () => [
      ...[...this.agents.values()].flatMap((a) => a.hits),
      ...[...this.stalls.values()].flatMap((s) => s.hits),
      ...this.city.hits.map((h) => h.mesh),
    ]
    let down: { x: number; y: number; moved: boolean } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, moved: false }
    }
    const onMove = (e: PointerEvent) => {
      if (down && e.buttons) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true
        if (!down.moved || this.stage.rig.zoom <= 1 + 1e-6) return
        const a = this.stage.ground(down.x, down.y)
        const b = this.stage.ground(e.clientX, e.clientY)
        if (a && b) {
          touch()
          this.stage.rig.x += a.x - b.x
          this.stage.rig.z += a.z - b.z
          this.stage.apply()
        }
        down.x = e.clientX
        down.y = e.clientY
        canvas.style.cursor = "grabbing"
        return
      }
      const hit = this.stage.pick(e.clientX, e.clientY, pickables())
      const id = hit?.object.userData.agentId as string | undefined
      const agent = id ? this.agents.get(id) : undefined
      if (agent !== hovered) {
        hovered?.setHover(false)
        agent?.setHover(true)
        hovered = agent
      }
      canvas.style.cursor = hit ? "pointer" : this.stage.rig.zoom > 1 + 1e-6 ? "grab" : ""
    }
    const onUp = (e: PointerEvent) => {
      const click = down && !down.moved
      down = null
      canvas.style.cursor = ""
      if (!click) return
      const hit = this.stage.pick(e.clientX, e.clientY, pickables())
      if (!hit) return
      const d = hit.object.userData as { agentId?: string; lotId?: string }
      if (d.agentId) return EventBus.emit("select", { kind: "agent", id: d.agentId })
      if (d.lotId) return EventBus.emit("select", { kind: "lot", id: d.lotId })
      const building = this.city.hits.find((h) => h.mesh === hit.object)?.building
      if (building) EventBus.emit("select", { kind: "building", id: building })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const r = canvas.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
        touch()
        animateTo(nextStep(this.stage.rig.zoom, e.key === "+" || e.key === "=" ? 1 : -1), cx, cy, 160)
      }
      if (e.key === "0") this.home()
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    canvas.addEventListener("gesturestart", onGestureStart)
    canvas.addEventListener("gesturechange", onGestureChange)
    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerup", onUp)
    window.addEventListener("keydown", onKey)
    this.offs.push(() => {
      settle?.()
      ease?.()
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("gesturestart", onGestureStart)
      canvas.removeEventListener("gesturechange", onGestureChange)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      window.removeEventListener("keydown", onKey)
    })
  }

  /**
   * No two labels overlap: where they would, the more important one stays (speech, then stalls,
   * weather and plaques, then building signs, then name tags) and the other fades until you zoom
   * in. From far away, stall cards show only their price and status.
   */
  private declutterLabels() {
    const PRIORITY: [string, number][] = [
      ["ft-bubble", 6],
      ["ft-stall", 5],
      ["ft-weather", 4],
      ["ft-plaque", 4],
      ["ft-sign", 3],
      ["ft-tag", 2],
    ]
    const root = this.stage.labels.domElement
    const run = () => {
      root.classList.toggle("ft-far", this.stage.rig.zoom < 1.8)
      // CSS2DRenderer hides an off-screen or invisible label with display: none on the label itself.
      const els = [
        ...root.querySelectorAll<HTMLElement>(".ft-bubble, .ft-stall, .ft-weather, .ft-plaque, .ft-sign, .ft-tag"),
      ].filter((el) => el.style.display !== "none")
      const labels = els.map((el) => {
        el.classList.remove("ft-hidden")
        const prio = PRIORITY.find(([c]) => el.classList.contains(c))?.[1] ?? 1
        // A chosen agent's tag counts as much as speech.
        const boost = el.dataset.selected === "true" ? 4 : 0
        return { rect: el.getBoundingClientRect(), priority: prio + boost }
      })
      // The HUD's windows (top bar, clock, QR, ticker, panel) are fixed obstacles: no label shows under them.
      const hud = [...document.querySelectorAll<HTMLElement>(".ft-hud-bar, .ft-hud .rpg-window, .ft-town-toast")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ rect: el.getBoundingClientRect(), priority: 1000 }))
      for (const i of declutter([...labels, ...hud])) if (i < els.length) els[i]!.classList.add("ft-hidden")
    }
    const timer = window.setInterval(run, 150)
    this.offs.push(() => window.clearInterval(timer))
  }

  // ---------------------------------------------------------------- vehicles

  /** A vehicle along a road path (map pixels), on its own side of the road, facing where it goes. */
  private driveAlong(mesh: THREE.Object3D, path: Point[], msPerTile: number, done: () => void): () => void {
    const line = polyline(path)
    return this.clock.tween(
      Math.max(1, (line.total / TILE_PX) * msPerTile),
      (t) => {
        const p = line.at(line.total * t)
        // Keep right: shift a quarter tile to the right of the direction of travel.
        const rx = -Math.cos(p.heading) * 0.25
        const rz = Math.sin(p.heading) * 0.25
        mesh.position.set(p.x / TILE_PX + rx, 0, p.y / TILE_PX + rz)
        mesh.rotation.y = p.heading
      },
      done,
    )
  }

  /** Cars with their headlights on, driving between road junctions. */
  private startTraffic() {
    const stops = this.town.anchors.roads
    if (stops.length < 2) return
    for (let i = 0; i < Math.min(4, stops.length); i++) {
      const mesh = this.models.make(CARS[i % CARS.length]!, "keep", { w: 0.6 })
      this.headlights(mesh, 0xfff1c9)
      this.world.add(mesh)
      const car: Car = { mesh, x: stops[i]!.x, y: stops[i]!.y, stop: () => {} }
      let target = i
      const next = () => {
        target = (target + 1 + Math.floor(Math.random() * (stops.length - 1))) % stops.length
        const from = { x: car.x, y: car.y }
        const path = this.roads.findPath(from, stops[target]!)
        if (!path || path.length < 2) return void (car.stop = this.clock.after(1500, next))
        car.stop = this.driveAlong(mesh, [from, ...path], STEP_MS * 2.2, () => {
          const end = path[path.length - 1]!
          car.x = end.x
          car.y = end.y
          car.stop = this.clock.after(800 + Math.random() * 2400, next)
        })
      }
      mesh.position.copy(w3(stops[i]!))
      car.stop = this.clock.after(300 + i * 900, next)
      this.traffic.push(car)
    }
  }

  private headlights(mesh: THREE.Object3D, colour: number) {
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1.4, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0.12, 0.95),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    const lamps = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.05, 0.03).translate(0, 0.14, 0.32),
      new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 4 }),
    )
    mesh.add(beam, lamps)
  }

  private truck(c: TownCommand & { kind: "driveTruck" }) {
    const from = this.standAt(this.roadGrid, anchorFor(this.town.anchors, c.from))
    const path = this.roads.findPath(from, anchorFor(this.town.anchors, c.to))
    if (path === null) return console.warn(`no road from ${c.from} to ${c.to}`)
    this.trucks.get(c.lotId)?.stop()
    const mesh = this.models.make("car/truck-flat", "keep", { w: 0.75 })
    this.headlights(mesh, 0xfff1c9)
    this.world.add(mesh)
    const truck: Car = { mesh, x: from.x, y: from.y, stop: () => {} }
    mesh.position.copy(w3(from))
    const line = polyline([from, ...path])
    const stopTween = this.clock.tween(
      Math.max(1, ((line.total / TILE_PX) * STEP_MS) / 2 / this.speed),
      (t) => {
        const p = line.at(line.total * t)
        // The probe reads the truck on the road's centre line; the model keeps to its side.
        truck.x = p.x
        truck.y = p.y
        mesh.position.set(p.x / TILE_PX - Math.cos(p.heading) * 0.25, 0, p.y / TILE_PX + Math.sin(p.heading) * 0.25)
        mesh.rotation.y = p.heading
      },
      () => truck.stop(),
    )
    truck.stop = () => {
      stopTween()
      mesh.removeFromParent()
      if (this.trucks.get(c.lotId) === truck) this.trucks.delete(c.lotId)
    }
    this.trucks.set(c.lotId, truck)
  }

  private startStress() {
    this.apply(stressCommands())
    let tick = 0
    const timer = window.setInterval(() => this.apply(stressWalk(tick++)), 1000)
    this.offs.push(() => window.clearInterval(timer))
  }

  // ---------------------------------------------------------------- commands

  private apply(commands: TownCommand[]) {
    for (const c of commands) this.applyOne(c)
    EventBus.emit("scene:applied", commands.length)
    if (!townStore.getState().ui.director) return
    const targets = commands.map((c) => focusFor(c, (lotId) => this.lotBuilding.get(lotId))).filter((b) => b !== null)
    const target = targets[targets.length - 1]
    if (target) this.focus(target, 4000)
  }

  private standAt(grid: WalkGrid, p: Point): Point {
    const t = nearestWalkable(grid, tileOf(grid, p))
    return t ? centreOf(grid, t) : p
  }

  private spotFor(agentId: string, building: Building): Point {
    const index = this.queue.claim(agentId, building)
    if (building === "town_gate" || index === null) return anchorFor(this.town.anchors, building)
    return this.town.anchors.buildings[building].queue[index]!
  }

  private stallSpot(c: TownCommand & { kind: "placeStall" }): Point {
    if (c.building === "town_gate") return this.town.anchors.gateSpawn
    const spots = this.town.anchors.buildings[c.building]
    return c.slot === null ? spots.entry : spots.stalls[c.slot - 1]!
  }

  private spawn(c: TownCommand & { kind: "spawnAgent" }) {
    const admitted = this.roster.admit(c.agentId, { human: c.highlight })
    if (!admitted) return console.warn(`town is full of walk-ins, not drawing ${c.label}`)
    if (admitted.evicted) {
      this.agents.get(admitted.evicted)?.retire()
      this.agents.delete(admitted.evicted)
      this.queue.release(admitted.evicted)
    }
    const previous = this.agents.get(c.agentId)
    if (previous && previous !== this.pool[admitted.slot]) previous.retire()
    let agent = this.pool[admitted.slot]
    if (!agent) {
      agent = new Agent3D(this.clock, this.models, (id) => EventBus.emit("select", { kind: "agent", id }))
      this.pool[admitted.slot] = agent
      this.world.add(agent.group)
    }
    agent.setSpeed(this.speed)
    const at = this.standAt(this.walkGrid, this.spotFor(c.agentId, c.building))
    agent.reset({ agentId: c.agentId, label: c.label, role: c.role, sprite: c.sprite, highlight: c.highlight }, at)
    const sel = townStore.getState().selection
    agent.setSelected(sel?.kind === "agent" && sel.id === c.agentId)
    this.agents.set(c.agentId, agent)
  }

  private walk(agentId: string, building: Building) {
    const agent = this.agents.get(agentId)
    if (!agent) return
    this.roster.touch(agentId)
    const path = this.people.findPath({ x: agent.x, y: agent.y }, this.spotFor(agentId, building))
    if (path === null) return console.warn(`no path for ${agentId} to ${building}`)
    agent.walk(path)
  }

  private probe(): SceneProbe {
    const agents: AgentProbe[] = [...this.agents.values()]
      .filter((a) => a.active)
      .map((a) => {
        const spot = this.queue.spotOf(a.agentId)
        return {
          id: a.agentId,
          x: a.x,
          y: a.y,
          blocked: !isWalkable(this.walkGrid, a),
          queue: spot ? `${spot.building}:${spot.index}` : null,
        }
      })
    const trucks: AgentProbe[] = [...this.trucks.entries()].map(([id, t]) => ({
      id,
      x: t.x,
      y: t.y,
      blocked: !isWalkable(this.roadGrid, t),
      queue: null,
    }))
    const stalls = [...this.stalls.entries()].map(([lotId, s]) => ({ lotId, ...this.stage.toCanvas(s.top) }))
    const rig = this.stage.rig
    const camera = {
      zoom: Math.round(rig.zoom * 1000) / 1000,
      x: Math.round(rig.x * TILE_PX),
      y: Math.round(rig.z * TILE_PX),
    }
    return { active: agents.length, agents, trucks, effectsSeen: Object.fromEntries(this.seen), stalls, camera }
  }

  private see(effect: string) {
    this.seen.set(effect, (this.seen.get(effect) ?? 0) + 1)
  }

  /** The building's roof for a place, or above the middle of the town. */
  private skyAt(place: string): { key: string; at: THREE.Vector3 } {
    const b = placeBuilding(place)
    if (!b || b === "town_gate")
      return { key: place, at: new THREE.Vector3(this.town.widthPx / TILE_PX / 2, 4, this.town.heightPx / TILE_PX / 2) }
    return { key: b, at: this.city.roofs[b as MarketBuilding] }
  }

  private placeStall(c: TownCommand & { kind: "placeStall" }) {
    const { evicted } = this.slots.place(c.lotId, c.building, c.slot)
    if (evicted) this.dropStall(evicted)
    this.dropStall(c.lotId)
    const stall = new Stall3D(this.clock, this.models, this.stallSpot(c), c, () =>
      EventBus.emit("select", { kind: "lot", id: c.lotId }),
    )
    stall.setClock(this.block)
    const tier = this.sellerTier.get(c.seller)
    if (tier) stall.setTier(tier)
    this.world.add(stall.group)
    this.stalls.set(c.lotId, stall)
    this.lotBuilding.set(c.lotId, c.building)
    this.stage.shadowsChanged()
  }

  private dropStall(lotId: string) {
    const s = this.stalls.get(lotId)
    if (!s) return
    s.group.removeFromParent()
    s.dispose()
    this.stalls.delete(lotId)
    this.stage.shadowsChanged()
  }

  private showToast(text: string, tone: "info" | "money" | "warn") {
    this.toast.textContent = text
    this.toast.dataset.tone = tone
    this.toast.classList.remove("ft-town-toast-in")
    void this.toast.offsetWidth
    this.toast.classList.add("ft-town-toast-in")
  }

  private applyOne(c: TownCommand) {
    const stall = "lotId" in c ? this.stalls.get(c.lotId) : undefined
    const fx = this.fx()
    switch (c.kind) {
      case "spawnAgent":
        this.see(c.highlight ? "spawnAgent:human" : "spawnAgent")
        return this.spawn(c)
      case "walkTo":
        this.see("walkTo")
        return this.walk(c.agentId, c.building)
      case "showBubble":
        this.see("showBubble")
        return this.agents.get(c.agentId)?.say(c.text)
      case "driveTruck":
        this.see("driveTruck")
        return this.truck(c)
      case "placeStall":
        this.see("placeStall")
        return this.placeStall(c)
      case "setStatus":
        this.see(`setStatus:${c.status}`)
        return stall?.setStatus(c.status, c.deadlineBlock)
      case "tickPrice":
        this.see(c.priceLabel ? "tickPrice:pulse" : "tickPrice")
        return stall?.setPrice(c.priceLabel, c.bids, this.speed)
      case "coinArc": {
        this.see("coinArc")
        const from = this.agents.get(c.agentId)
        if (stall && from) arc(fx, from.chest, stall.top, 0xffc857)
        return
      }
      case "flashClear":
        this.see("flashClear")
        // Every clearing passes through the settlement hub: a cyan spark runs from it to the stall.
        if (stall) arc(fx, new THREE.Vector3(this.city.core.x, 2.4, this.city.core.z), stall.top, 0x3fd8ff, 1100)
        return stall?.flash(this.speed)
      case "fadeStall":
        this.see("fadeStall")
        return stall?.fade(c.newFloorLabel)
      case "moveCrate": {
        this.see("moveCrate")
        if (!stall) return
        const to =
          c.to === "truck" ? anchorFor(this.town.anchors, "freight_yard") : anchorFor(this.town.anchors, c.from)
        return crate(fx, stall.top, w3(c.to === "truck" ? to : { x: to.x, y: to.y + 16 }, 0.2))
      }
      case "openVault": {
        this.see("openVault")
        const at = w3(this.town.anchors.buildings.cold_vault.entry)
        flare(fx, at, 0x9be7ff)
        return burst(fx, at, 0x9be7ff, 1200, 2)
      }
      case "refundCoins": {
        this.see("refundCoins")
        const to = this.agents.get(c.buyer)
        if (stall && to) {
          arc(fx, stall.top, to.chest, 0xffb35c)
          floatText(fx, to.chest, c.amountLabel, "money")
        }
        return
      }
      case "signNoShow":
        this.see("signNoShow")
        return stall?.markNoShow()
      case "markSeller":
        this.see(`markSeller:${c.tier}`)
        this.sellerTier.set(c.seller, c.tier)
        for (const s of this.stalls.values()) if (s.seller === c.seller) s.setTier(c.tier)
        return
      case "inspect":
        this.see("inspect")
        if (stall) {
          burst(fx, stall.top, 0x3fd8ff, 1200, 1.4)
          floatText(fx, stall.top, "Checking the goods", "info")
        }
        return
      case "refundBadge":
        this.see("refundBadge")
        if (stall) floatText(fx, stall.top, c.label, "warn")
        return stall?.setRefundBadge(c.label)
      case "plaque":
        this.see("plaque")
        if (c.building === "town_gate") return
        return this.sky.plaque(c.building, this.city.roofs[c.building as MarketBuilding], c.text)
      case "setWeather": {
        this.see(`setWeather:${c.weather}`)
        const { key, at } = this.skyAt(c.place)
        if (c.weather === "storm") return this.sky.storm(key, at, c.label)
        if (c.weather === "quiet") return this.sky.quiet(key, at, c.label)
        return
      }
      case "setLights": {
        if (c.place) {
          this.see("setLights:festival")
          const { key, at } = this.skyAt(c.place)
          return this.sky.festival(key, at, c.label ?? "")
        }
        this.see(c.on ? "setLights:night" : "setLights:day")
        return this.stage.setDaylight(!c.on)
      }
      case "setClock":
        this.block = c.block
        for (const s of this.stalls.values()) s.setClock(c.block)
        return
      case "toast":
        this.see(`toast:${c.tone}`)
        return this.showToast(c.text, c.tone)
      case "setPhase":
        this.see("setPhase")
        return this.stage.setDaylight(c.phase !== "night" && c.phase !== "evening")
      default: {
        const unreachable: never = c
        return unreachable
      }
    }
  }

  dispose() {
    this.disposed = true
    for (const off of this.offs.splice(0)) off()
    this.clock.clear()
    for (const a of this.pool) a.dispose()
    for (const s of this.stalls.values()) s.dispose()
    this.toast.remove()
    this.stage.dispose()
  }
}
