import type { Building } from "@fairtown/shared/keys"
import { GameObjects, Scene, Tilemaps } from "phaser"
import { EventBus, type AgentProbe, type SceneProbe } from "../EventBus"
import { AgentSprite, ensurePlaceholderTextures, STEP_MS } from "../agents/AgentSprite"
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
import { buildStubMap } from "../map/stub-map"
import type { TiledMap } from "../map/tiled"

const MAP_KEY = "town"
const MAP_URL = "/assets/maps/town.tmj"
const SPRITES_KEY = "sprites"
const SPRITES_URL = "/assets/sprites/sprites.json"
const MAX_AGENTS = 80
const VIEW = { width: 1920, height: 1080 }
const DEPTH = { stall: 10, truck: 15, agent: 20, text: 30, toast: 40 } as const
const TEXT = { fontFamily: "monospace", color: "#f8fafc", stroke: "#0f172a", strokeThickness: 2, resolution: 3 }

type Stall = { box: GameObjects.Rectangle; label: GameObjects.Text; base: string }

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
  private readonly trucks = new Map<string, GameObjects.Rectangle>()
  private readonly stalls = new Map<string, Stall>()
  private toast!: GameObjects.Text
  private speed = 1
  private unsubscribe: (() => void) | undefined

  constructor() {
    super("Town")
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_KEY, MAP_URL)
    this.load.json(SPRITES_KEY, SPRITES_URL)
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b1220")
    this.speed = Math.max(1, Number(new URLSearchParams(window.location.search).get("speed")) || 1)
    ensurePlaceholderTextures(this)
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
    const tilesets = map.tilesets
      .map((t) => map.addTilesetImage(t.name, `tileset:${t.name}`))
      .filter((t): t is Tilemaps.Tileset => t !== null)
    for (const name of TILE_LAYERS) {
      const layer = map.createLayer(name, tilesets)
      if (name === "collision") layer?.setVisible(false).setCollisionByExclusion([-1])
    }
  }

  /** A broken map must not stop the demo: use the stub layout, show and log what is wrong. */
  private fallback(problems: string[]) {
    console.error("Town map problems, using the fallback layout:", problems)
    const stubRaw = buildStubMap()
    const stub = parseTownMap(stubRaw)
    if (!stub.ok) throw new Error(`fallback map is invalid: ${stub.problems.join("; ")}`)
    const g = this.add.graphics()
    g.fillStyle(0x1e293b)
    for (const b of MARKET_BUILDINGS) {
      const { label, entry } = stub.value.anchors.buildings[b]
      g.fillRect(label.x - 64, label.y + 8, 128, entry.y - label.y - 16)
    }
    this.begin(stub.value, stubRaw, problems)
    this.add
      .text(8, stub.value.heightPx - 8, problems.slice(0, 6).join("\n"), { ...TEXT, fontSize: "7px", color: "#fca5a5" })
      .setOrigin(0, 1)
      .setDepth(DEPTH.toast)
  }

  private begin(town: TownMap, raw: TiledMap, problems: string[]) {
    this.town = town
    this.walkGrid = buildWalkGrid(raw)
    this.roadGrid = buildRoadGrid(raw)
    this.people = createPathfinder(this.walkGrid)
    this.roads = createPathfinder(this.roadGrid)

    const zoom = Math.min(VIEW.width / town.widthPx, VIEW.height / town.heightPx)
    this.cameras.main.setZoom(zoom).centerOn(town.widthPx / 2, town.heightPx / 2)
    for (const b of MARKET_BUILDINGS) {
      const { label } = town.anchors.buildings[b]
      this.add
        .text(label.x, label.y, BUILDING_SIGNS[b], { ...TEXT, fontSize: "8px" })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.text)
    }
    const gate = town.anchors.gateSpawn
    this.add
      .text(gate.x, gate.y - 10, BUILDING_SIGNS.town_gate, { ...TEXT, fontSize: "8px" })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.text)
    this.toast = this.add
      .text(town.widthPx / 2, 6, "", { ...TEXT, fontSize: "10px" })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.toast)

    this.unsubscribe = EventBus.on("town:commands", (commands) => this.apply(commands))
    const stop = () => this.unsubscribe?.()
    this.events.once("shutdown", stop)
    this.events.once("destroy", stop)
    EventBus.emit("scene:probe", () => this.probe())
    EventBus.emit("map:status", {
      status: problems.length > 0 ? "error" : "ready",
      buildings: MARKET_BUILDINGS.length,
      problems,
    })
    EventBus.emit("scene:ready", undefined)
  }

  private apply(commands: TownCommand[]) {
    for (const c of commands) this.applyOne(c)
    EventBus.emit("scene:applied", commands.length)
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
    const sprite = (this.pool[admitted.slot] ??= new AgentSprite(this).setDepth(DEPTH.agent))
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
    const truck = this.add.rectangle(from.x, from.y, 12, 8, 0xf97316).setStrokeStyle(1, 0x0f172a).setDepth(DEPTH.truck)
    this.trucks.set(c.lotId, truck)
    const stepMs = STEP_MS / 2 / this.speed
    const step = (i: number) => {
      const next = path[i]
      if (!next) {
        truck.destroy()
        if (this.trucks.get(c.lotId) === truck) this.trucks.delete(c.lotId)
        return
      }
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
    return { active: agents.length, agents, trucks }
  }

  private applyOne(c: TownCommand) {
    switch (c.kind) {
      case "spawnAgent":
        return this.spawn(c)
      case "walkTo":
        return this.walk(c.agentId, c.building)
      case "showBubble":
        return this.agents.get(c.agentId)?.say(c.text)
      case "driveTruck":
        return this.drive(c)
      case "placeStall": {
        const at = this.stallSpot(c)
        const old = this.stalls.get(c.lotId)
        old?.box.destroy()
        old?.label.destroy()
        // Alternate labels above and below so neighbouring stalls stay readable.
        const above = (c.slot ?? 0) % 2 === 1
        const box = this.add.rectangle(at.x, at.y, 12, 10, c.slot === null ? 0x475569 : 0x0f766e).setDepth(DEPTH.stall)
        const base = `${c.commodity} ${c.floorLabel}`
        const label = this.add
          .text(at.x, above ? at.y - 6 : at.y + 6, base, { ...TEXT, fontSize: "5px" })
          .setOrigin(0.5, above ? 1 : 0)
          .setDepth(DEPTH.text)
        this.stalls.set(c.lotId, { box, label, base })
        return
      }
      case "setStatus": {
        const stall = this.stalls.get(c.lotId)
        stall?.label.setText(`${stall.base} · ${c.status}`)
        if (c.status === "paid_in_full") stall?.box.setFillStyle(0xca8a04)
        if (c.status === "refunded" || c.status === "no_show_reported") stall?.box.setFillStyle(0xb91c1c)
        return
      }
      case "tickPrice": {
        const stall = this.stalls.get(c.lotId)
        if (stall && c.priceLabel) stall.label.setText(`${stall.base} · now ${c.priceLabel}`)
        return
      }
      case "fadeStall":
        this.stalls.get(c.lotId)?.box.setAlpha(0.4)
        return
      case "toast":
        this.toast.setText(c.text).setColor(c.tone === "warn" ? "#fca5a5" : c.tone === "money" ? "#86efac" : "#f8fafc")
        return
      case "setPhase":
        this.cameras.main.setBackgroundColor(c.phase === "night" || c.phase === "evening" ? "#050914" : "#0b1220")
        return
      default:
        // flashClear, moveCrate, setWeather, setLights, markSeller, refundCoins: drawn in S3 1.3.
        return
    }
  }
}
