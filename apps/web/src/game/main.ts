import { AUTO, Game, Scale, type Types } from "phaser"
import { Town } from "./scenes/Town"

const config: Types.Core.GameConfig = {
  type: AUTO,
  width: 1920,
  height: 1080,
  backgroundColor: "#0b1220",
  pixelArt: true,
  // Clicks on the HUD windows over the canvas must not also hit the building underneath.
  input: { windowEvents: false },
  scale: { mode: Scale.FIT, autoCenter: Scale.CENTER_BOTH },
  scene: [Town],
}

export function startGame(parent: string): Game {
  return new Game({ ...config, parent })
}
