import { useLayoutEffect, useRef } from "react"
import { TownEngine } from "./engine"

/** Mounts one 3D town and disposes of it on unmount. Keeps the #game-container id e2e relies on. */
export function TownCanvas({ className = "h-screen w-full" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!host.current) return
    const engine = new TownEngine(host.current)
    return () => engine.dispose()
  }, [])
  return <div id="game-container" ref={host} className={`ft-town relative overflow-hidden ${className}`} />
}
