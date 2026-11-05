import { GameObjects, Scene, Tilemaps } from "phaser"
import { EventBus } from "../EventBus"
import type { TownCommand } from "../commands"
import { MARKET_BUILDINGS, TILE_LAYERS, anchorFor, parseTownMap, type Point, type TownMap } from "../map/anchors"
import { BUILDING_SIGNS } from "../map/buildings"
import { buildStubMap } from "../map/stub-map"
import type { TiledMap } from "../map/tiled"

const MAP_KEY = "town"
const MAP_URL = "/assets/maps/town.tmj"
const VIEW = { width: 1920, height: 1080 }
const DEPTH = { stall: 10, agent: 20, text: 30, toast: 40 } as const
const TEXT = { fontFamily: "monospace", color: "#f8fafc", stroke: "#0f172a", strokeThickness: 2, resolution: 3 }

type Stall = { box: GameObjects.Rectangle; label: GameObjects.Text; base: string }

/** The town: a Tiled map (S3 1.1) with stalls and agents placed on its anchors, driven by reducer commands. */
export class Town extends Scene {
  private town!: TownMap
  private stalls = new Map<string, Stall>()
  private agents = new Map<string, GameObjects.Container>()
  private toast!: GameObjects.Text
  private unsubscribe: (() => void) | undefined

  constructor() {
    super("Town")
  }

  preload() {
    this.load.tilemapTiledJSON(MAP_KEY, MAP_URL)
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b1220")
    const raw = (this.cache.tilemap.get(MAP_KEY) as { data?: unknown } | undefined)?.data
    if (raw === undefined) return this.fallback([`could not load ${MAP_URL}`])
    const result = parseTownMap(raw)
    if (!result.ok) return this.fallback(result.problems)
    this.loadTilesets(raw as TiledMap, result.value)
  }

  /** Tileset images come from the map's own paths, so new packs need no code change. */
  private loadTilesets(raw: TiledMap, town: TownMap) {
    const base = new URL("/assets/maps/", window.location.href)
    const failed: string[] = []
    for (const t of raw.tilesets) this.load.image(`tileset:${t.name}`, new URL(t.image!, base).href)
    this.load.on("loaderror", (file: { src: string }) => failed.push(`could not load tileset image ${file.src}`))
    this.load.once("complete", () => {
      if (failed.length > 0) return this.fallback(failed)
      this.drawTiles()
      this.begin(town, [])
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
    const stub = parseTownMap(buildStubMap())
    if (!stub.ok) throw new Error(`fallback map is invalid: ${stub.problems.join("; ")}`)
    const g = this.add.graphics()
    g.fillStyle(0x1e293b)
    for (const b of MARKET_BUILDINGS) {
      const { label, entry } = stub.value.anchors.buildings[b]
      g.fillRect(label.x - 64, label.y + 8, 128, entry.y - label.y - 16)
    }
    this.begin(stub.value, problems)
    this.add
      .text(8, stub.value.heightPx - 8, problems.slice(0, 6).join("\n"), { ...TEXT, fontSize: "7px", color: "#fca5a5" })
      .setOrigin(0, 1)
      .setDepth(DEPTH.toast)
  }

  private begin(town: TownMap, problems: string[]) {
    this.town = town
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

  private stallSpot(building: TownCommand & { kind: "placeStall" }): Point {
    const { building: b, slot } = building
    if (b === "town_gate") return this.town.anchors.gateSpawn
    const spots = this.town.anchors.buildings[b]
    return slot === null ? spots.queue[spots.queue.length - 1]! : spots.stalls[slot - 1]!
  }

  private agentSpot(building: Parameters<typeof anchorFor>[1], index: number): Point {
    if (building === "town_gate") return this.town.anchors.gateSpawn
    const queue = this.town.anchors.buildings[building].queue
    return queue[index % queue.length]!
  }

  private applyOne(c: TownCommand) {
    switch (c.kind) {
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
      case "spawnAgent": {
        this.agents.get(c.agentId)?.destroy()
        const at = this.agentSpot(c.building, this.agents.size)
        const dot = this.add.circle(0, 0, 4, c.highlight ? 0xfacc15 : 0x60a5fa)
        const name = this.add.text(0, -6, c.label, { ...TEXT, fontSize: "5px" }).setOrigin(0.5, 1)
        this.agents.set(c.agentId, this.add.container(at.x, at.y, [dot, name]).setDepth(DEPTH.agent))
        return
      }
      case "walkTo": {
        const agent = this.agents.get(c.agentId)
        const to = anchorFor(this.town.anchors, c.building)
        if (agent) this.tweens.add({ targets: agent, x: to.x, y: to.y, duration: 600 })
        return
      }
      case "showBubble": {
        const agent = this.agents.get(c.agentId)
        if (!agent) return
        const bubble = this.add
          .text(agent.x, agent.y - 14, c.text, { ...TEXT, fontSize: "5px", backgroundColor: "#1e293b" })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.toast)
        this.time.delayedCall(2500, () => bubble.destroy())
        return
      }
      case "toast":
        this.toast.setText(c.text).setColor(c.tone === "warn" ? "#fca5a5" : c.tone === "money" ? "#86efac" : "#f8fafc")
        return
      case "setPhase":
        this.cameras.main.setBackgroundColor(c.phase === "night" || c.phase === "evening" ? "#050914" : "#0b1220")
        return
      default:
        // flashClear, driveTruck, moveCrate, setWeather, setLights, markSeller, refundCoins: drawn in S3 1.3.
        return
    }
  }
}
