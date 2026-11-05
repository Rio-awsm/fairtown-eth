import { AUTO, Game, Scale, type Types } from "phaser"
import { Town } from "./scenes/Town"

const config: Types.Core.GameConfig = {
  type: AUTO,
  width: 1920,
  height: 1080,
  backgroundColor: "#0b1220",
  scale: { mode: Scale.FIT, autoCenter: Scale.CENTER_BOTH },
  scene: [Town],
}

export function startGame(parent: string): Game {
  return new Game({ ...config, parent })
}
