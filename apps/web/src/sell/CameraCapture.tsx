import type { Photo } from "@fairtown/shared/api"
import { useEffect, useRef, useState } from "react"
import type { z } from "zod"

export type CapturedPhoto = z.input<typeof Photo>
type Place = { lat: number; lon: number } | undefined

const defaultGetMedia = (c: MediaStreamConstraints) => {
  if (!navigator.mediaDevices?.getUserMedia)
    return Promise.reject(Object.assign(new Error("no camera API"), { name: "NotSupportedError" }))
  return navigator.mediaDevices.getUserMedia(c)
}

/** A still from the live video. In-app only: there is no file upload, so photos are fresh. */
function defaultGrab(video: HTMLVideoElement): string {
  const canvas = document.createElement("canvas")
  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 480
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.8)
}

function defaultLocate(): Promise<Place> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(undefined),
      { timeout: 3000, maximumAge: 60_000 },
    )
  })
}

type Props = {
  lotCode: string
  count: number
  max: number
  onPhoto(photo: CapturedPhoto): void
  getMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  grab?: (video: HTMLVideoElement) => string
  locate?: () => Promise<Place>
}

/** In-app camera with the lot code to hold in frame (S3 2.1). Each photo carries the code, time and place. */
export function CameraCapture({
  lotCode,
  count,
  max,
  onPhoto,
  getMedia = defaultGetMedia,
  grab = defaultGrab,
  locate = defaultLocate,
}: Props) {
  const [state, setState] = useState<"idle" | "opening" | "live" | "blocked" | "unsupported">("idle")
  const stream = useRef<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  const close = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setState("idle")
  }
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), [])
  useEffect(() => {
    if (state === "live" && video.current && stream.current) video.current.srcObject = stream.current
  }, [state])

  const open = async () => {
    setState("opening")
    try {
      stream.current = await getMedia({ video: { facingMode: "environment" }, audio: false })
      setState("live")
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : ""
      console.warn("camera did not open", error)
      setState(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "unsupported")
    }
  }

  const take = async () => {
    if (!video.current) return
    const dataUrl = grab(video.current)
    const capturedAt = new Date().toISOString()
    const gps = await locate()
    onPhoto({ dataUrl, lotCode, capturedAt, ...(gps ? { gps } : {}) })
  }

  return (
    <div className="space-y-2">
      {state === "live" ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded">
            <video ref={video} autoPlay playsInline muted className="w-full" aria-label="Camera" />
            <p className="rpg-badge absolute top-3 left-3 bg-parchment px-2 py-1 text-sm text-ink">
              Hold the code {lotCode} in the photo
            </p>
            <p
              className="rpg-badge absolute right-3 bottom-3 bg-coin px-3 py-1 font-mono text-3xl text-ink"
              aria-hidden
            >
              {lotCode}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="rpg-btn rpg-btn-go flex-1" onClick={() => void take()} disabled={count >= max}>
              Take photo
            </button>
            <button className="rpg-btn rpg-btn-quiet" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <button
          className="rpg-btn rpg-btn-quiet w-full"
          onClick={() => void open()}
          disabled={count >= max || state === "opening"}
        >
          Open camera
        </button>
      )}
      <p className="text-xs text-ink-soft">
        {count} of {max} photos
      </p>
      {state === "blocked" && (
        <p role="alert" className="text-sm text-gold-ink">
          The camera is blocked. Allow it for this site in your phone settings, then try again.
        </p>
      )}
      {state === "unsupported" && (
        <p role="alert" className="text-sm text-gold-ink">
          This browser cannot open the camera here. Open the secure link (https) on your phone.
        </p>
      )}
    </div>
  )
}
