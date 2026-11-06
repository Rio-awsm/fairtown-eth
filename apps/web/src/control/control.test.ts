import { describe, expect, it, vi } from "vitest"
import { focusFor } from "../game/director"
import { STRESS_AGENTS, STRESS_STALLS, stressCommands, stressWalk } from "../game/stress"
import { soundFor } from "../sound/triggers"
import { openControlChannel, parseControl } from "./channel"

describe("control messages", () => {
  it.each([
    [{ type: "director", on: true }],
    [{ type: "priceWeather", on: false }],
    [{ type: "qr", on: true }],
    [{ type: "clockFocus", on: true }],
    [{ type: "mute", on: false }],
    [{ type: "jump", building: "fish_dock" }],
    [{ type: "speed", speed: 20 }],
    [{ type: "hello" }],
  ])("accepts %o", (msg) => {
    expect(parseControl(msg)).toEqual(msg)
  })

  it.each([
    [{ type: "jump", building: "moon" }],
    [{ type: "speed", speed: 0 }],
    [{ type: "speed", speed: 500 }],
    [{ type: "nuke" }],
    ["hello"],
  ])("rejects %o", (msg) => {
    expect(parseControl(msg)).toBeNull()
  })

  it("delivers valid messages between windows and drops bad ones", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const got: unknown[] = []
    const town = openControlChannel((m) => got.push(m))
    const control = openControlChannel(() => {})
    control.post({ type: "jump", building: "flower_hall" })
    new BroadcastChannel("fairtown-control").postMessage({ type: "nuke" })
    await new Promise((r) => setTimeout(r, 30))
    expect(got).toEqual([{ type: "jump", building: "flower_hall" }])
    expect(warn).toHaveBeenCalled()
    town.close()
    control.close()
    warn.mockRestore()
  })
})

describe("camera director focus", () => {
  it.each([
    [{ kind: "placeStall", building: "fish_dock" }, "fish_dock"],
    [{ kind: "spawnAgent", building: "town_gate", highlight: true }, "town_gate"],
    [{ kind: "spawnAgent", building: "fish_dock", highlight: false }, null],
    [{ kind: "moveCrate", from: "fish_dock" }, "fish_dock"],
    [{ kind: "driveTruck", to: "freight_yard" }, "freight_yard"],
    [{ kind: "toast" }, null],
  ] as const)("%o focuses %s", (command, building) => {
    expect(focusFor(command as never, () => "flower_hall")).toBe(building)
  })

  it("follows a lot's building for sales and no-shows", () => {
    expect(focusFor({ kind: "flashClear", lotId: "12" }, () => "fish_dock")).toBe("fish_dock")
    expect(focusFor({ kind: "setStatus", lotId: "60", status: "no_show_reported" }, () => "fish_dock")).toBe(
      "fish_dock",
    )
    expect(focusFor({ kind: "setStatus", lotId: "60", status: "open" }, () => "fish_dock")).toBeNull()
  })
})

describe("sound triggers", () => {
  it.each([
    [{ kind: "coinArc" }, "coin"],
    [{ kind: "flashClear" }, "gavel"],
    [{ kind: "setWeather", weather: "storm" }, "rain"],
    [{ kind: "setLights", on: true, place: "mumbai" }, "bells"],
    [{ kind: "setStatus", status: "paid_in_full" }, "bells"],
    [{ kind: "setLights", on: true }, null],
    [{ kind: "toast" }, null],
  ] as const)("%o plays %s", (command, sound) => {
    expect(soundFor(command as never)).toBe(sound)
  })
})

describe("stress mode", () => {
  it("spawns 60 agents and 18 stalls across six buildings", () => {
    const cmds = stressCommands()
    expect(cmds.filter((c) => c.kind === "spawnAgent")).toHaveLength(STRESS_AGENTS)
    const stalls = cmds.filter((c) => c.kind === "placeStall")
    expect(stalls).toHaveLength(STRESS_STALLS)
    expect(new Set(stalls.map((c) => c.kind === "placeStall" && `${c.building}:${c.slot}`)).size).toBe(18)
  })

  it("walks agents between buildings in a repeatable order", () => {
    expect(stressWalk(0)).toEqual(stressWalk(0))
    expect(stressWalk(1)).not.toEqual(stressWalk(0))
    expect(stressWalk(0).every((c) => c.kind === "walkTo")).toBe(true)
  })
})
