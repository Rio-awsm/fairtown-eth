import { z } from "zod"
import { MARKET_BUILDINGS } from "../game/map/anchors"

/**
 * Presenter controls from /control to /town (S3 5.1) over a BroadcastChannel: works between windows on
 * one computer. A phone remote would need a relay message (S2). Every message is validated.
 */
export const CHANNEL = "fairtown-control"
const on = z.boolean()
export const ControlMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("director"), on }),
  z.object({ type: z.literal("priceWeather"), on }),
  z.object({ type: z.literal("qr"), on }),
  z.object({ type: z.literal("clockFocus"), on }),
  z.object({ type: z.literal("mute"), on }),
  z.object({ type: z.literal("jump"), building: z.enum(MARKET_BUILDINGS as [string, ...string[]]) }),
  z.object({ type: z.literal("speed"), speed: z.number().positive().max(100) }),
  z.object({ type: z.literal("hello") }),
  z.object({
    type: z.literal("state"),
    ui: z.object({ director: on, priceWeather: on, qr: on, clockFocus: on, muted: on }),
    speed: z.number(),
  }),
])
export type ControlMessage = z.infer<typeof ControlMessage>

export const parseControl = (raw: unknown): ControlMessage | null => {
  const parsed = ControlMessage.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export type ControlChannel = { post(msg: ControlMessage): void; close(): void }

export function openControlChannel(onMessage: (msg: ControlMessage) => void): ControlChannel {
  if (typeof BroadcastChannel === "undefined") return { post: () => {}, close: () => {} }
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (e: MessageEvent) => {
    const msg = parseControl(e.data)
    if (msg) onMessage(msg)
    else console.warn("ignored a control message that does not fit", e.data)
  }
  return { post: (msg) => channel.postMessage(msg), close: () => channel.close() }
}
