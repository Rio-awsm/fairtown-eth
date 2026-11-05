import type { RelayClient } from "../net/relayClient"

/** The running relay or replay client, so /control can change the replay speed (S3 5.1). */
let active: { client: RelayClient; speed: number } | null = null
export const setActiveRelay = (client: RelayClient, speed: number) => {
  active = { client, speed }
}
export const replaySpeed = () => active?.speed ?? 1
export function setReplaySpeed(speed: number): void {
  if (!active?.client.setSpeed) return
  active.client.setSpeed(speed)
  active.speed = speed
}
