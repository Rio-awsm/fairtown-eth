import { useLayoutEffect, useRef } from "react"
import type { Game } from "phaser"
import { startGame } from "./main"

const CONTAINER_ID = "game-container"

/** Mounts one Phaser game and destroys it on unmount (adapted from phaserjs/template-react-ts). */
export function PhaserGame({ className = "h-[calc(100vh-49px)] w-full" }: { className?: string }) {
  const game = useRef<Game | null>(null)

  useLayoutEffect(() => {
    if (game.current === null) game.current = startGame(CONTAINER_ID)
    return () => {
      game.current?.destroy(true)
      game.current = null
    }
  }, [])

  return <div id={CONTAINER_ID} className={className} />
}
