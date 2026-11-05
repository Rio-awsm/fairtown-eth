import type { Building } from "@fairtown/shared/keys"
import { GameObjects, Scene } from "phaser"
import { EventBus } from "../EventBus"
import type { TownCommand } from "../commands"

// Placeholder layout after source of truth 13, until S3 1.1 brings the Tiled map and anchors.
const BUILDING_AT: Record<Building, { x: number; y: number; name: string }> = {
  fish_dock: { x: 260, y: 200, name: "Fish Dock" },
  freight_yard: { x: 1500, y: 200, name: "Freight Yard" },
  flower_hall: { x: 420, y: 520, name: "Flower Hall" },
  compute_yard: { x: 1180, y: 520, name: "Compute Yard" },
  cold_vault: { x: 1640, y: 520, name: "Cold Vault" },
  harvest_hall: { x: 260, y: 840, name: "Harvest Hall" },
  neighbourhood_pool: { x: 1580, y: 840, name: "Neighbourhood Pool" },
  town_gate: { x: 920, y: 960, name: "Town Gate" },
}
const TEXT = { fontFamily: "monospace", color: "#e2e8f0" } as const

type Stall = { box: GameObjects.Rectangle; label: GameObjects.Text; base: string }

export class Town extends Scene {
  private stalls = new Map<string, Stall>()
  private agents = new Map<string, GameObjects.Container>()
  private toast!: GameObjects.Text
  private unsubscribe: (() => void) | undefined

  constructor() {
    super("Town")
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b1220")
    for (const b of Object.values(BUILDING_AT)) {
      this.add.rectangle(b.x, b.y, 300, 180, 0x1e293b).setStrokeStyle(2, 0x334155)
      this.add.text(b.x - 140, b.y - 120, b.name, { ...TEXT, fontSize: "22px" })
    }
    this.toast = this.add.text(960, 40, "", { ...TEXT, fontSize: "28px" }).setOrigin(0.5, 0)

    this.unsubscribe = EventBus.on("town:commands", (commands) => this.apply(commands))
    const stop = () => this.unsubscribe?.()
    this.events.once("shutdown", stop)
    this.events.once("destroy", stop)
    EventBus.emit("scene:ready", undefined)
  }

  private apply(commands: TownCommand[]) {
    for (const c of commands) this.applyOne(c)
    EventBus.emit("scene:applied", commands.length)
  }

  private applyOne(c: TownCommand) {
    switch (c.kind) {
      case "placeStall": {
        const b = BUILDING_AT[c.building]
        const slot = c.slot ?? 0
        const x = b.x - 100 + ((slot - 1) % 3) * 100
        const y = b.y - 30 + Math.floor((slot - 1) / 3) * 60
        this.stalls.get(c.lotId)?.box.destroy()
        this.stalls.get(c.lotId)?.label.destroy()
        const base = `#${c.lotId} ${c.commodity}\n${c.floorLabel}`
        const box = this.add.rectangle(x, y, 92, 52, c.slot === null ? 0x475569 : 0x0f766e)
        const label = this.add.text(x - 44, y - 24, base, { ...TEXT, fontSize: "12px" })
        this.stalls.set(c.lotId, { box, label, base })
        return
      }
      case "setStatus": {
        const stall = this.stalls.get(c.lotId)
        stall?.label.setText(`${stall.base}\n${c.status}`)
        if (c.status === "paid_in_full") stall?.box.setFillStyle(0xca8a04)
        if (c.status === "refunded" || c.status === "no_show_reported") stall?.box.setFillStyle(0xb91c1c)
        return
      }
      case "tickPrice": {
        const stall = this.stalls.get(c.lotId)
        if (stall && c.priceLabel) stall.label.setText(`${stall.base}\nnow ${c.priceLabel}`)
        return
      }
      case "fadeStall":
        this.stalls.get(c.lotId)?.box.setAlpha(0.4)
        return
      case "spawnAgent": {
        this.agents.get(c.agentId)?.destroy()
        const b = BUILDING_AT[c.building]
        const dot = this.add.circle(0, 0, 8, c.highlight ? 0xfacc15 : 0x60a5fa)
        const name = this.add.text(10, -8, c.label, { ...TEXT, fontSize: "12px" })
        const agent = this.add.container(b.x + (this.agents.size % 5) * 24 - 60, b.y + 70, [dot, name])
        this.agents.set(c.agentId, agent)
        return
      }
      case "walkTo": {
        const agent = this.agents.get(c.agentId)
        const b = BUILDING_AT[c.building]
        if (agent) this.tweens.add({ targets: agent, x: b.x, y: b.y + 70, duration: 600 })
        return
      }
      case "showBubble": {
        const agent = this.agents.get(c.agentId)
        if (!agent) return
        const bubble = this.add.text(agent.x, agent.y - 30, c.text, {
          ...TEXT,
          fontSize: "12px",
          backgroundColor: "#1e293b",
        })
        this.time.delayedCall(2500, () => bubble.destroy())
        return
      }
      case "toast":
        this.toast.setText(c.text).setColor(c.tone === "warn" ? "#fca5a5" : c.tone === "money" ? "#86efac" : "#e2e8f0")
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
