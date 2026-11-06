import type { Building } from "@fairtown/shared/keys"
import { fs, setTextScale } from "../textScale"
import { env } from "../../config"
import { townStore } from "../../state/townStore"
import { focusFor } from "../director"
import { stressCommands, stressWalk } from "../stress"
import { GameObjects, Scene, Tilemaps } from "phaser"
import { EventBus, type AgentProbe, type SceneProbe } from "../EventBus"
import { AgentSprite, STEP_MS } from "../agents/AgentSprite"
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
} from "../agents/pathing"
import { QueueAllocator } from "../agents/queue"
import { AgentRoster } from "../agents/roster"
import type { TownCommand } from "../commands"
import { MARKET_BUILDINGS, TILE_LAYERS, anchorFor, parseTownMap, type Point, type TownMap } from "../map/anchors"
import { BUILDING_SIGNS } from "../map/buildings"
import { buildStubMap, STUB_TILESET_NAME } from "../map/stub-map"
import { footprintOf, layoutScenery } from "../map/scenery"
import { BUILDING_SPRITE, chimneyAt, windowsAt } from "../art/buildings"
import { SIGN_TEXT, TOWN_TEXT } from "../art/text"
import { ART, TREE_KINDS, registerArt } from "../art/textures"
import { fitZoom, glideAt, splitSign } from "./layout"
import { Sky, coinArc, floatText, magnifier, moveCrate, refundCoins, vaultDoor } from "../effects/effects"
import { StallView } from "../market/StallView"
import { StallSlots, placeBuilding } from "../market/slots"
import { BAND_COLOUR } from "../../arkiv/weather"
import type { TiledMap } from "../map/tiled"

const MAP_KEY = "town"
const MAP_URL = "/assets/maps/town.tmj"
const SPRITES_KEY = "sprites"
const SPRITES_URL = "/assets/sprites/sprites.json"
const MAX_AGENTS = 80
const VIEW = { width: 1920, height: 1080 }
const DEPTH = { building: 3, prop: 4, glow: 6, stall: 10, truck: 15, agent: 20, gate: 26, text: 30, toast: 40 } as const
const TEXT = TOWN_TEXT

/** The town: a Tiled map (S3 1.1) with stalls, pathing agents (S3 1.2) and trucks, driven by reducer commands. */
export class Town extends Scene {
  private town!: TownMap
  private walkGrid!: WalkGrid
  private roadGrid!: WalkGrid
  private people!: Pathfinder
  private roads!: Pathfinder
  private readonly queue = new QueueAllocator(8)
  private readonly roster = new AgentRoster(MAX_AGENTS)
  private readonly pool: AgentSprite[] = []
  private readonly agents = new Map<string, AgentSprite>()
  private readonly trucks = new Map<string, GameObjects.Image>()
  private readonly stalls = new Map<string, StallView>()
  private readonly slots = new StallSlots()
  private readonly seen = new Map<string, number>()
  private readonly sellerTier = new Map<string, "new" | "proven">()
  private sky!: Sky
  private block = 0
  private toast!: GameObjects.Text
  private speed = 1
  private baseZoom = 1
  private readonly lotBuilding = new Map<string, Building>()
  private focusUntil = 0
  private focusTimer: Phaser.Time.TimerEvent | undefined
  private unsubscribe: (() => void) | undefined
  /** No drifting or bobbing: screenshot baselines (?until, ?relay=off) and reduced motion. */
  private still = false
  /** Tile layers waiting to be baked into the static town texture by drawWorld. */
  private baseLayers: GameObjects.GameObject[] = []

  constructor() {
    super("Town")
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_KEY, MAP_URL)
    this.load.json(SPRITES_KEY, SPRITES_URL)
  }

  create() {
    this.cameras.main.setBackgroundColor("#3f7d45")
    const params = new URLSearchParams(window.location.search)
    this.still =
      (env.exposeTown && (params.has("until") || params.get("relay") === "off")) ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    this.speed = Math.max(1, Number(params.get("speed")) || 1)
    // ?demo=1: bigger town text for a projector (S3 5.1).
    setTextScale(params.get("demo") === "1" ? 1.6 : 1)
    registerArt(this)
    const raw = (this.cache.tilemap.get(MAP_KEY) as { data?: unknown } | undefined)?.data
    if (raw === undefined) return this.fallback([`could not load ${MAP_URL}`])
    const result = parseTownMap(raw)
    if (!result.ok) return this.fallback(result.problems)
    this.loadAssets(raw as TiledMap, result.value)
  }

  /** Tileset images come from the map's own paths; persona sheets from sprites.json. */
  private loadAssets(raw: TiledMap, town: TownMap) {
    const base = new URL("/assets/maps/", window.location.href)
    const failed: string[] = []
    for (const t of raw.tilesets) this.load.image(`tileset:${t.name}`, new URL(t.image!, base).href)
    const sheets = (this.cache.json.get(SPRITES_KEY) as { sheets?: string[] } | undefined)?.sheets ?? []
    for (const name of sheets)
      this.load.spritesheet(`sprite:${name}`, `/assets/sprites/${name}.png`, { frameWidth: 16, frameHeight: 16 })
    this.load.on("loaderror", (file: { key: string; src: string }) => {
      if (file.key.startsWith("tileset:")) failed.push(`could not load tileset image ${file.src}`)
      else console.warn(`could not load ${file.src}, using the placeholder`)
    })
    this.load.once("complete", () => {
      if (failed.length > 0) return this.fallback(failed)
      this.drawTiles()
      this.begin(town, raw, [])
    })
    this.load.start()
  }

  private drawTiles() {
    const map = this.make.tilemap({ key: MAP_KEY })
    // Our generated tileset is painted in memory, so it matches the code even if the PNG is stale.
    const tilesets = map.tilesets
      .map((t) => map.addTilesetImage(t.name, t.name === STUB_TILESET_NAME ? ART.tileset : `tileset:${t.name}`))
      .filter((t): t is Tilemaps.Tileset => t !== null)
    // Our generated map's building tiles only block walking; the painted building sprites draw them.
    const ours = map.tilesets.some((t) => t.name === STUB_TILESET_NAME)
    for (const name of TILE_LAYERS) {
      if (ours && name === "buildings") continue
      const layer = map.createLayer(name, tilesets)
      if (layer && name !== "collision") this.baseLayers.push(layer)
      if (name === "collision") layer?.setVisible(false).setCollisionByExclusion([-1])
    }
  }

  /** A broken map must not stop the demo: use the stub layout, show and log what is wrong. */
  private fallback(problems: string[]) {
    console.error("Town map problems, using the fallback layout:", problems)
    const stubRaw = buildStubMap()
    const stub = parseTownMap(stubRaw)
    if (!stub.ok) throw new Error(`fallback map is invalid: ${stub.problems.join("; ")}`)
    // Draw the stub layout with the painted tiles, so a broken map still looks like Fairtown.
    this.cache.tilemap.add("town-fallback", { format: Tilemaps.Formats.TILED_JSON, data: stubRaw })
    const map = this.make.tilemap({ key: "town-fallback" })
    const tileset = map.addTilesetImage(STUB_TILESET_NAME, ART.tileset)
    if (tileset)
      for (const name of TILE_LAYERS) {
        if (name === "collision" || name === "buildings") continue
        const layer = map.createLayer(name, tileset)
        if (layer) this.baseLayers.push(layer)
      }
    this.begin(stub.value, stubRaw, problems)
    this.add
      .text(8, stub.value.heightPx - 8, problems.slice(0, 6).join("\n"), { ...TEXT, fontSize: fs(7), color: "#ffb4a8" })
      .setOrigin(0, 1)
      .setDepth(DEPTH.toast)
  }

  private begin(town: TownMap, raw: TiledMap, problems: string[]) {
    this.town = town
    this.sky = new Sky(this)
    this.walkGrid = buildWalkGrid(raw)
    this.roadGrid = buildRoadGrid(raw)
    this.people = createPathfinder(this.walkGrid)
    this.roads = createPathfinder(this.roadGrid)

    const zoom = fitZoom(VIEW, { w: town.widthPx, h: town.heightPx })
    this.baseZoom = zoom
    // Bounds keep director close-ups from ever showing past the map edge.
    this.cameras.main
      .setBounds(0, 0, town.widthPx, town.heightPx)
      .setZoom(zoom)
      .centerOn(town.widthPx / 2, town.heightPx / 2)
    this.drawWorld(town)
    this.toast = this.add
      // Centred in the open sky right of the HUD windows.
      .text(town.widthPx * 0.72, 8, "", { ...TEXT, fontSize: fs(10), strokeThickness: 4 })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.toast)

    this.unsubscribe = EventBus.on("town:commands", (commands) => this.apply(commands))
    const offWeather = EventBus.on("priceWeather", (bands) => {
      if (bands) this.see("priceWeather")
      this.sky.priceWeather(
        bands &&
          MARKET_BUILDINGS.flatMap((b) => {
            const band = bands[b]
            if (!band) return []
            const { label, entry } = this.town.anchors.buildings[b]
            return [{ colour: BAND_COLOUR[band], x: label.x - 64, y: label.y + 4, w: 128, h: entry.y - label.y - 8 }]
          }),
      )
    })
    const offJump = EventBus.on("camera:jump", (b) => this.focus(b as Building, 6000, true))
    // Keep the selected agent's name tag up while its panel is open.
    const offSelect = townStore.subscribe((s, prev) => {
      if (s.selection === prev.selection) return
      if (prev.selection?.kind === "agent") this.agents.get(prev.selection.id)?.setSelected(false)
      if (s.selection?.kind === "agent") this.agents.get(s.selection.id)?.setSelected(true)
    })
    // Turning the director off sends the camera straight home.
    const offDirector = townStore.subscribe((s, prev) => {
      if (prev.ui.director && !s.ui.director) this.home()
    })
    const fps = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => EventBus.emit("scene:fps", Math.round(this.game.loop.actualFps * 10) / 10),
    })
    const stop = () => {
      this.unsubscribe?.()
      offWeather()
      offJump()
      offSelect()
      offDirector()
      fps.remove()
    }
    this.events.once("shutdown", stop)
    this.events.once("destroy", stop)
    EventBus.emit("scene:probe", () => this.probe())
    EventBus.emit("map:status", {
      status: problems.length > 0 ? "error" : "ready",
      buildings: MARKET_BUILDINGS.length,
      problems,
    })
    EventBus.emit("scene:ready", undefined)
    if (env.exposeTown && new URLSearchParams(window.location.search).get("stress") === "1") this.startStress()
  }

  /** Buildings, signs, scenery, the gate, the boat, and the ambient life of the town. */
  private drawWorld(town: TownMap) {
    const glows: GameObjects.Image[] = []
    const glow = (x: number, y: number, scale: number) => {
      const g = this.add.image(x, y, ART.glow).setScale(scale).setBlendMode("ADD").setDepth(DEPTH.glow).setAlpha(0.85)
      glows.push(g)
    }
    const select = (b: Building) => () => EventBus.emit("select", { kind: "building", id: b })
    // Ground, buildings and scenery never change: they are drawn once into one texture (see bake).
    const statics: GameObjects.GameObject[] = [...this.baseLayers]
    for (const b of MARKET_BUILDINGS) {
      const f = footprintOf(town, b)
      const left = f.x + f.w / 2 - BUILDING_SPRITE.w / 2
      const top = f.y + f.h - (BUILDING_SPRITE.h - 4)
      statics.push(new GameObjects.Image(this, left, top, ART.building(b)).setOrigin(0, 0))
      // The baked building cannot be clicked, so an invisible zone over it opens its panel.
      this.add
        .zone(left + 4, top + 8, BUILDING_SPRITE.w - 8, BUILDING_SPRITE.h - 12)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", select(b))
      for (const w of windowsAt(b)) glow(left + w.x, top + w.y, 0.7)
      const chimney = chimneyAt(b)
      if (chimney && !this.still)
        this.add
          .particles(left + chimney.x, top + chimney.y, ART.puff, {
            speedY: { min: -14, max: -8 },
            speedX: { min: 2, max: 6 },
            scale: { start: 0.6, end: 1.3 },
            alpha: { start: 0.75, end: 0 },
            lifespan: 2600,
            frequency: 700,
          })
          .setDepth(DEPTH.building + 0.5)
      this.sign(town.anchors.buildings[b].label, BUILDING_SIGNS[b], select(b))
    }

    for (const p of layoutScenery(town, this.walkGrid, this.roadGrid)) {
      const key =
        p.kind === "tree"
          ? ART.tree(p.variant % TREE_KINDS)
          : p.kind === "pine"
            ? ART.pine
            : p.kind === "bush"
              ? ART.bush
              : ART.lamp
      statics.push(new GameObjects.Image(this, p.x, p.y + 2, key).setOrigin(0.5, 1))
      if (p.kind === "lamp") glow(p.x, p.y - 22, 1.1)
    }

    this.bake(town, statics)

    const gate = town.anchors.gateSpawn
    this.add
      .image(gate.x, gate.y + 12, ART.gate)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.gate)
    this.add
      .text(gate.x, gate.y - 19, BUILDING_SIGNS.town_gate, { ...SIGN_TEXT, fontSize: fs(5), color: "#fffaea" })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.gate + 1)

    // A boat moored off the Fish Dock, if that spot is water.
    const dock = town.anchors.buildings.fish_dock.label
    const mooring = { x: dock.x + 44, y: dock.y - 50 }
    if (!isWalkable(this.walkGrid, mooring) && mooring.y > 0) {
      const boat = this.add.image(mooring.x, mooring.y, ART.boat).setDepth(DEPTH.prop)
      if (!this.still)
        this.tweens.add({
          targets: boat,
          y: mooring.y + 1.5,
          duration: 1400,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        })
    }
    this.sky.setNightLights(glows)
    if (!this.still) this.ambient(town)
  }

  /**
   * Draws the static town into one texture, in order, then drops the originals: one full-screen quad
   * per frame instead of five tile layers, seven buildings and about sixty props (S3 5.1 frame budget).
   */
  private bake(town: TownMap, statics: GameObjects.GameObject[]) {
    const base = this.add.renderTexture(0, 0, town.widthPx, town.heightPx).setOrigin(0, 0).setDepth(0)
    base.draw(statics)
    base.render()
    for (const o of statics) o.destroy()
    this.baseLayers = []
  }

  /** Water glints and drifting cloud shadows. Off for baselines and reduced motion. */
  private ambient(town: TownMap) {
    const water: Point[] = []
    const roads = this.roadGrid
    for (let y = 0; y < this.walkGrid.height; y++)
      for (let x = 0; x < this.walkGrid.width; x++) {
        const inBuilding = MARKET_BUILDINGS.some((b) => {
          const f = footprintOf(town, b)
          return x * 16 >= f.x - 16 && x * 16 < f.x + f.w + 16 && y * 16 >= f.y - 16 && y * 16 < f.y + f.h + 16
        })
        if (this.walkGrid.cells[y]![x] === 1 && roads.cells[y]![x] === 1 && !inBuilding)
          water.push(centreOf(this.walkGrid, { x, y }))
      }
    if (water.length > 0)
      this.add
        .particles(0, 0, ART.sparkle, {
          emitZone: {
            type: "random",
            source: {
              getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
                const at = water[Math.floor(Math.random() * water.length)]!
                point.x = at.x + (Math.random() - 0.5) * 14
                point.y = at.y + (Math.random() - 0.5) * 14
                return point
              },
            },
          },
          alpha: {
            start: 0,
            end: 1,
            ease: "Sine.easeInOut",
            yoyo: true,
          } as unknown as Phaser.Types.GameObjects.Particles.EmitterOpOnEmitType,
          scale: { min: 0.6, max: 1 },
          lifespan: 1400,
          frequency: 160,
          quantity: 1,
        })
        .setDepth(DEPTH.prop - 0.5)
    for (let i = 0; i < 2; i++) {
      const cloud = this.add
        .image(-120 - i * 520, 120 + i * 220, ART.cloud)
        .setScale(4)
        .setTint(0x000000)
        .setAlpha(0.08)
        .setDepth(DEPTH.text - 1)
      this.tweens.add({
        targets: cloud,
        x: town.widthPx + 160,
        duration: 70_000 + i * 15_000,
        repeat: -1,
        delay: i * 9000,
      })
    }
  }

  /** A wooden plaque: building name on top, the place it serves underneath. */
  private sign(at: Point, text: string, onSelect: () => void) {
    const { title, subtitle } = splitSign(text)
    const c = this.add.container(at.x, at.y + 2).setDepth(DEPTH.text)
    const head = this.add.text(0, 0, title, { ...SIGN_TEXT, fontSize: fs(6) }).setOrigin(0.5, 0.5)
    const sub = subtitle
      ? this.add.text(0, 0, subtitle, { ...SIGN_TEXT, fontSize: fs(4), color: "#5b4a63" }).setOrigin(0.5, 0.5)
      : undefined
    const w = Math.ceil(Math.max(head.width, sub?.width ?? 0) + 10)
    const h = sub ? 19 : 12
    head.setY(sub ? -3.5 : 0)
    sub?.setY(5)
    const g = this.add.graphics()
    g.fillStyle(0x2a1f33).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2)
    g.fillStyle(0x7a4b2a).fillRect(-w / 2, -h / 2, w, h)
    g.fillStyle(0xf8eccb).fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2)
    g.fillStyle(0xd9c08a).fillRect(-w / 2 + 1, h / 2 - 2, w - 2, 1)
    g.fillStyle(0x2a1f33, 0.3).fillRect(-w / 2 + 1, h / 2 + 1, w, 2)
    c.add([g, head, ...(sub ? [sub] : [])])
    c.setSize(w, h).setInteractive({ useHandCursor: true }).on("pointerdown", onSelect)
  }

  /** Stress mode (dev only): 60 agents and 18 stalls, with ten agents walking every second. */
  private startStress() {
    this.apply(stressCommands())
    let tick = 0
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.apply(stressWalk(tick++)) })
  }

  /** Camera director (S3 5.1): ease to a building, hold, then back to the whole town. */
  private focus(building: Building, holdMs: number, force = false) {
    const now = this.time.now
    if (!force && now < this.focusUntil - holdMs / 2) return
    const at = anchorFor(this.town.anchors, building)
    this.glide(at, this.baseZoom * 1.6)
    this.focusUntil = now + holdMs
    this.focusTimer?.remove()
    this.focusTimer = this.time.delayedCall(holdMs, () => this.home())
  }

  private home() {
    this.focusTimer?.remove()
    this.focusUntil = 0
    this.glide({ x: this.town.widthPx / 2, y: this.town.heightPx / 2 }, this.baseZoom)
  }

  /**
   * Ease zoom and centre together. One zoom effect re-centres every frame, so a glide that starts
   * mid-way through another (D pressed during a close-up) still lands exactly, inside the bounds.
   */
  private glide(to: Point, zoom: number) {
    const cam = this.cameras.main
    const from = { x: cam.midPoint.x, y: cam.midPoint.y }
    cam.zoomTo(zoom, 600, "Sine.easeInOut", true, (c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      const t = glideAt(progress)
      c.centerOn(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    })
  }

  private apply(commands: TownCommand[]) {
    for (const c of commands) this.applyOne(c)
    EventBus.emit("scene:applied", commands.length)
    if (!townStore.getState().ui.director) return
    const targets = commands.map((c) => focusFor(c, (lotId) => this.lotBuilding.get(lotId))).filter((b) => b !== null)
    const target = targets[targets.length - 1]
    if (target) this.focus(target, 4000)
  }

  /** Tile centre nearest to a point that people can stand on. */
  private standAt(grid: WalkGrid, p: Point): Point {
    const t = nearestWalkable(grid, tileOf(grid, p))
    return t ? centreOf(grid, t) : p
  }

  /** The agent's queue spot at a building, or the entry when the queue is full. */
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
    const onSelect = (id: string) => EventBus.emit("select", { kind: "agent", id })
    const sprite = (this.pool[admitted.slot] ??= new AgentSprite(this, onSelect).setDepth(DEPTH.agent))
    sprite.setSpeed(this.speed)
    const at = this.standAt(this.walkGrid, this.spotFor(c.agentId, c.building))
    sprite.reset({ agentId: c.agentId, label: c.label, role: c.role, sprite: c.sprite, highlight: c.highlight }, at)
    this.agents.set(c.agentId, sprite)
  }

  private walk(agentId: string, building: Building) {
    const sprite = this.agents.get(agentId)
    if (!sprite) return
    this.roster.touch(agentId)
    const path = this.people.findPath({ x: sprite.x, y: sprite.y }, this.spotFor(agentId, building))
    if (path === null) return console.warn(`no path for ${agentId} to ${building}`)
    sprite.walk(path)
  }

  private drive(c: TownCommand & { kind: "driveTruck" }) {
    const from = this.standAt(this.roadGrid, anchorFor(this.town.anchors, c.from))
    const path = this.roads.findPath(from, anchorFor(this.town.anchors, c.to))
    if (path === null) return console.warn(`no road from ${c.from} to ${c.to}`)
    this.trucks.get(c.lotId)?.destroy()
    const truck = this.add
      .image(from.x, from.y + 2, ART.truck)
      .setOrigin(0.5, 0.8)
      .setDepth(DEPTH.truck)
    this.trucks.set(c.lotId, truck)
    const stepMs = STEP_MS / 2 / this.speed
    const step = (i: number) => {
      const next = path[i]
      if (!next) {
        truck.destroy()
        if (this.trucks.get(c.lotId) === truck) this.trucks.delete(c.lotId)
        return
      }
      if (next.x !== truck.x) truck.setFlipX(next.x < truck.x)
      this.tweens.add({ targets: truck, x: next.x, y: next.y, duration: stepMs, onComplete: () => step(i + 1) })
    }
    step(0)
  }

  private probe(): SceneProbe {
    const agents: AgentProbe[] = [...this.agents.values()]
      .filter((s) => s.active)
      .map((s) => {
        const spot = this.queue.spotOf(s.agentId)
        return {
          id: s.agentId,
          x: s.x,
          y: s.y,
          blocked: !isWalkable(this.walkGrid, s),
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
    const cam = this.cameras.main
    const stalls = [...this.stalls.entries()].map(([lotId, s]) => ({
      lotId,
      x: (s.x - cam.worldView.x) * cam.zoom,
      y: (s.y - cam.worldView.y) * cam.zoom,
    }))
    return { active: agents.length, agents, trucks, effectsSeen: Object.fromEntries(this.seen), stalls }
  }

  private see(effect: string) {
    this.seen.set(effect, (this.seen.get(effect) ?? 0) + 1)
  }

  /** The building's sky point for a place, or the map centre. */
  private skyAt(place: string): { key: string; at: Point } {
    const b = placeBuilding(place)
    if (!b || b === "town_gate") return { key: place, at: { x: this.town.widthPx / 2, y: 60 } }
    return { key: b, at: this.town.anchors.buildings[b].label }
  }

  private agentAt(agentId: string): Point | undefined {
    const a = this.agents.get(agentId)
    return a ? { x: a.x, y: a.y } : undefined
  }

  private placeStall(c: TownCommand & { kind: "placeStall" }) {
    const { evicted } = this.slots.place(c.lotId, c.building, c.slot)
    if (evicted) {
      this.stalls.get(evicted)?.destroy()
      this.stalls.delete(evicted)
    }
    this.stalls.get(c.lotId)?.destroy()
    // Alternate labels above and below so neighbouring stalls stay readable.
    const stall = new StallView(this, this.stallSpot(c), c, (c.slot ?? 0) % 2 === 1).setDepth(DEPTH.stall)
    stall.onSelect(() => EventBus.emit("select", { kind: "lot", id: c.lotId }))
    stall.setClock(this.block)
    const tier = this.sellerTier.get(c.seller)
    if (tier) stall.setTier(tier)
    this.stalls.set(c.lotId, stall)
    this.lotBuilding.set(c.lotId, c.building)
  }

  private applyOne(c: TownCommand) {
    const stall = "lotId" in c ? this.stalls.get(c.lotId) : undefined
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
        return this.drive(c)
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
        const from = this.agentAt(c.agentId)
        if (stall && from) coinArc(this, from, stall, this.speed)
        return
      }
      case "flashClear":
        this.see("flashClear")
        return stall?.flash(this.speed)
      case "fadeStall":
        this.see("fadeStall")
        return stall?.fade(c.newFloorLabel)
      case "moveCrate": {
        this.see("moveCrate")
        if (!stall) return
        const to =
          c.to === "truck" ? anchorFor(this.town.anchors, "freight_yard") : anchorFor(this.town.anchors, c.from)
        return moveCrate(this, stall, c.to === "truck" ? to : { x: to.x, y: to.y + 16 }, this.speed)
      }
      case "openVault":
        this.see("openVault")
        return vaultDoor(this, this.town.anchors.buildings.cold_vault.entry, this.speed)
      case "refundCoins": {
        this.see("refundCoins")
        const to = this.agentAt(c.buyer)
        if (stall && to) refundCoins(this, stall, to, c.amountLabel, this.speed)
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
        if (stall) magnifier(this, stall, this.speed)
        return
      case "refundBadge":
        this.see("refundBadge")
        if (stall) floatText(this, stall, c.label, "#fdba74", this.speed)
        return stall?.setRefundBadge(c.label)
      case "plaque":
        this.see("plaque")
        if (c.building === "town_gate") return
        return this.sky.plaque(c.building, this.town.anchors.buildings[c.building].label, c.text)
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
        return this.sky.setNight(c.on, { w: this.town.widthPx, h: this.town.heightPx })
      }
      case "setClock":
        this.block = c.block
        for (const s of this.stalls.values()) s.setClock(c.block)
        return
      case "toast":
        this.see(`toast:${c.tone}`)
        this.toast.setText(c.text).setColor(c.tone === "warn" ? "#ffb4a8" : c.tone === "money" ? "#c6f6a8" : "#fffaea")
        return
      case "setPhase":
        this.see("setPhase")
        this.cameras.main.setBackgroundColor(c.phase === "night" || c.phase === "evening" ? "#1b1f4a" : "#3f7d45")
        return
      default: {
        const unreachable: never = c
        return unreachable
      }
    }
  }
}
