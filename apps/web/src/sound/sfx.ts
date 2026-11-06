import type { EventBusApi } from "../game/EventBus"
import type { TownStoreState } from "../state/townStore"
import type { StoreApi } from "zustand/vanilla"
import { soundFor, type Sound } from "./triggers"

/** Town sounds made in the browser with Web Audio: our own work (CC0), so no sound files to license. */
let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    return ctx
  } catch (error: unknown) {
    console.warn("no Web Audio, staying silent", error)
    return null
  }
}

/** Call from a click: browsers only allow sound after a user gesture. */
export function unlockAudio(): void {
  void audio()?.resume()
}

function tone(a: AudioContext, freq: number, start: number, length: number, type: OscillatorType, peak: number) {
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain).connect(a.destination)
  osc.start(start)
  osc.stop(start + length + 0.05)
}

function noise(a: AudioContext, start: number, length: number, peak: number, band: number) {
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * length), a.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buffer
  const filter = a.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.value = band
  const gain = a.createGain()
  gain.gain.setValueAtTime(peak, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  src.connect(filter).connect(gain).connect(a.destination)
  src.start(start)
}

export function play(sound: Sound): void {
  const a = audio()
  if (!a || a.state !== "running") return
  const t = a.currentTime
  if (sound === "coin") {
    tone(a, 1320, t, 0.08, "square", 0.05)
    tone(a, 1760, t + 0.07, 0.12, "square", 0.05)
  } else if (sound === "gavel") {
    tone(a, 110, t, 0.18, "triangle", 0.4)
    noise(a, t, 0.08, 0.3, 600)
  } else if (sound === "bells") {
    for (const [i, f] of [880, 1320, 1760].entries()) tone(a, f, t + i * 0.12, 1.2, "sine", 0.08)
  } else {
    noise(a, t, 1.6, 0.08, 1200)
  }
}

/** Plays the sound for each kind of command once per batch, unless muted. Returns an unsubscribe. */
export function attachSound(bus: EventBusApi, store: StoreApi<TownStoreState>): () => void {
  return bus.on("town:commands", (commands) => {
    if (store.getState().ui.muted) return
    const sounds = new Set(commands.map(soundFor).filter((s): s is Sound => s !== null))
    for (const s of sounds) play(s)
  })
}
