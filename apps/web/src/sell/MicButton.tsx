import { useRef, useState } from "react"
import { api } from "../net/api"
import { SPEECH_LANGUAGE, voiceMode } from "./model"

type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
type Recognition = {
  lang: string
  interimResults?: boolean
  onresult?: (e: SpeechResultEvent) => void
  onerror?: () => void
  onend?: () => void
  start(): void
}
type RecorderLike = { ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void; start(): void; stop(): void }

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error ?? new Error("could not read audio"))
    reader.readAsDataURL(blob)
  })

type Props = {
  onText(text: string): void
  win?: object
  getMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
}

/** Voice input (D-08): English browser speech, else record and send to /api/stt, else hidden. */
export function MicButton({ onText, win = window, getMedia = (c) => navigator.mediaDevices.getUserMedia(c) }: Props) {
  const mode = voiceMode(win)
  const [busy, setBusy] = useState<"idle" | "listening" | "recording" | "sending">("idle")
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<RecorderLike | null>(null)
  if (mode === "none") return null

  const listen = () => {
    const w = win as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = SPEECH_LANGUAGE
    rec.interimResults = false
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript
      if (text) onText(text)
      setBusy("idle")
    }
    rec.onerror = () => {
      setError("Could not hear that. Try again, or type it.")
      setBusy("idle")
    }
    rec.onend = () => setBusy("idle")
    setError(null)
    setBusy("listening")
    rec.start()
  }

  const record = async () => {
    setError(null)
    try {
      const stream = await getMedia({ audio: true })
      const Ctor = (win as { MediaRecorder: new (s: MediaStream) => RecorderLike }).MediaRecorder
      const r = new Ctor(stream)
      const chunks: Blob[] = []
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setBusy("sending")
        void toBase64(new Blob(chunks))
          .then((audioBase64) => api.stt({ body: { audioBase64, language: SPEECH_LANGUAGE } }))
          .then((res) => onText(res.text))
          .catch((e: unknown) => {
            console.warn("speech to text failed", e)
            setError("Could not turn that into text. Please type it.")
          })
          .finally(() => setBusy("idle"))
      }
      recorder.current = r
      r.start()
      setBusy("recording")
    } catch (e: unknown) {
      console.warn("microphone did not open", e)
      setError("The microphone is blocked. Allow it in your phone settings, or type.")
      setBusy("idle")
    }
  }

  const label =
    busy === "recording" ? "Stop" : busy === "listening" ? "Listening…" : busy === "sending" ? "Reading…" : "Speak"
  const onClick = () => {
    if (busy === "recording") return recorder.current?.stop()
    if (mode === "speech") return listen()
    void record()
  }
  return (
    <div>
      <button
        className="rounded bg-slate-700 px-4 py-3"
        onClick={onClick}
        disabled={busy === "listening" || busy === "sending"}
      >
        {label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}
