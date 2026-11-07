import "@fontsource-variable/inter-tight"
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { LandingSections, PARTNERS } from "./LandingSections"
import { LogoMark, Wordmark } from "./Logo"
import { SiteNav } from "./SiteNav"
import { REC, clipTime, heroAt, progressOf, recProgress, smooth } from "./progress"
import "./landing.css"

const MEDIA = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P"
export const CLIP_DESKTOP = `${MEDIA}/65fdef53-5686-4659-8761-52d61bf1a4f7.mp4`
export const CLIP_SMALL = `${MEDIA}/9a30e5e9-9f03-4755-9bc1-7bcf1510aab3.mp4`
export const POSTER = `${MEDIA}/33150b94-09f7-47da-a7c9-3ae76c2dd7eb.jpg`

/** The four steps of every Fairtown deal, in the words a seller would use. */
export const STEPS = [
  {
    title: "List it in plain words",
    body: "A seller says what they have and the lowest price they will take: 600 kg of cod, €7.50 a kilo. No forms, no jargon.",
  },
  {
    title: "Agents bid within caps",
    body: "Each buyer's agent bids up to the cap its owner set, never past it, and tells the seller what it is offering.",
  },
  {
    title: "One fair price for all",
    body: "When the auction ends, every winner pays the same clearing price, however early or high they bid.",
  },
  {
    title: "Paid at the handover",
    body: "Part of the money reaches the seller at once; the rest is released when the goods change hands. Every step has a deadline, so no deal is left hanging.",
  },
] as const

/** The loader fades 350 ms after the clip's first frame, or after 3.5 s whatever happens. */
const LOADER_AFTER_FRAME_MS = 350
const LOADER_MAX_MS = 3500
/** Once the hero's bottom edge rises above this many px, the nav needs a backing (nav + phone badge row). */
const NAV_BACKING_AT = 120

declare global {
  interface Window {
    /** Recorder hook (?rec=1): put the hero at capture time t (s) and return the clip time. */
    __recTime?: (video: HTMLVideoElement, t: number) => number
  }
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

/**
 * Fairtown's landing: a scroll-driven hero over a night-city glide clip (the NORVA hero brief).
 * Scrolling scrubs the clip forward over the city to the hub while the headline lies back into
 * the ground and the four deal steps take over the bottom left. All scene motion is the clip's.
 */
export function LandingPage() {
  const rec = new URLSearchParams(window.location.search).get("rec") === "1"
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const headline = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const cue = useRef<HTMLDivElement>(null)
  const cueLine = useRef<HTMLSpanElement>(null)
  const [step, setStep] = useState(0)
  const [loaded, setLoaded] = useState(rec)
  const [small] = useState(() => window.matchMedia?.("(max-width: 900px)").matches === true)

  useEffect(() => {
    if (loaded) return
    const v = video.current
    let wait: number | undefined
    const done = () => (wait = window.setTimeout(() => setLoaded(true), LOADER_AFTER_FRAME_MS))
    const most = window.setTimeout(() => setLoaded(true), LOADER_MAX_MS)
    if (v && v.readyState >= 2) done()
    else v?.addEventListener("loadeddata", done, { once: true })
    return () => {
      window.clearTimeout(most)
      window.clearTimeout(wait)
      v?.removeEventListener("loadeddata", done)
    }
  }, [loaded])

  useEffect(() => {
    const v = video.current
    const t = track.current
    if (!v || !t) return
    const reduced = reducedMotion()
    let cur = 0
    let shownStep = -1
    let raf = 0
    let recP: number | null = null
    const trackBox = () => ({ top: t.getBoundingClientRect().top + window.scrollY, height: t.offsetHeight })
    const scrollToP = (p: number) => {
      const box = trackBox()
      window.scrollTo(0, box.top + p * Math.max(0, box.height - window.innerHeight))
    }
    const paint = (p: number) => {
      const view = heroAt(p)
      const h = headline.current
      if (h) {
        h.style.transform = `translateY(${view.headline.y}vh) rotateX(${view.headline.rotate}deg) scale(${view.headline.scale})`
        h.style.opacity = String(view.headline.opacity)
        h.style.visibility = view.headline.opacity <= 0 ? "hidden" : "visible"
      }
      if (list.current) {
        list.current.style.transform = `translateY(${view.list.y}px)`
        list.current.style.opacity = String(view.list.opacity)
        list.current.style.visibility = view.list.opacity <= 0 ? "hidden" : "visible"
      }
      if (cue.current) cue.current.style.opacity = String(view.cue.opacity)
      if (cueLine.current) cueLine.current.style.transform = `scaleX(${view.cue.line})`
      if (view.step !== shownStep) {
        shownStep = view.step
        setStep(view.step)
      }
    }
    const seek = () => {
      if (!v.seeking && Math.abs(v.currentTime - cur) > 1 / 60) v.currentTime = cur
    }
    v.addEventListener("seeked", seek)

    // Recorder mode: a 6.5 s Web Animation is the clock that drives p.
    const driver = rec
      ? document.createElement("div").animate([{ opacity: 0 }, { opacity: 1 }], REC.total * 1000)
      : null
    driver?.pause()
    const startRec = () => {
      if (driver?.playState === "paused" && recP === null) driver.play()
    }
    // The glide starts with the clip's first frame, or after 3.5 s if the clip never arrives.
    const recFallback = rec ? window.setTimeout(startRec, LOADER_MAX_MS) : undefined
    if (rec) {
      v.addEventListener("loadeddata", startRec, { once: true })
      window.__recTime = (target: HTMLVideoElement, time: number) => {
        driver?.pause()
        recP = recProgress(time)
        scrollToP(recP)
        paint(recP)
        cur = clipTime(recP, target.duration)
        target.currentTime = cur
        return cur
      }
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      let p: number
      if (recP !== null) p = recP
      else if (driver && driver.playState !== "paused") {
        p = recProgress(Number(driver.currentTime ?? 0) / 1000)
        scrollToP(p)
      } else p = progressOf(window.scrollY, trackBox(), window.innerHeight)
      paint(p)
      // Past the hero the nav floats over page content, so it gets a backing (CSS keys off this).
      const past = String(t.getBoundingClientRect().bottom < NAV_BACKING_AT)
      if (root.current && root.current.dataset.past !== past) root.current.dataset.past = past
      const target = clipTime(p, v.duration)
      cur = reduced || recP !== null ? target : smooth(cur, target)
      seek()
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener("seeked", seek)
      v.removeEventListener("loadeddata", startRec)
      driver?.cancel()
      window.clearTimeout(recFallback)
      if (rec) delete window.__recTime
    }
  }, [rec])

  return (
    <div ref={root} className="landing" data-loaded={loaded} data-past="false">
      <SiteNav howHref="#how" />

      <div ref={track} className="landing-track" id="top">
        {/* "How a deal works" lands here: the headline has gone and step 01 is open. */}
        <span id="how" className="landing-how" />
        <div className="landing-scene">
          <video
            ref={video}
            className="landing-video"
            src={small ? CLIP_SMALL : CLIP_DESKTOP}
            poster={POSTER}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="landing-shade" />
          {/* Inside the sticky scene, so the steps scroll away with the clip when the hero ends. */}
          <ol ref={list} className="landing-steps" aria-label="How a deal works">
            {STEPS.map((s, i) => (
              <li key={s.title} className="landing-step" aria-current={i === step ? "step" : undefined}>
                <span className="landing-step-num">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="landing-step-title">{s.title}</p>
                  <div className="landing-step-body">
                    <p>{s.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <LandingSections />

      <div className="landing-stage">
        <div ref={headline} className="landing-hero">
          <h1 className="landing-title">
            One Fair Price
            <br />
            for Every Harvest
          </h1>
          <div className="landing-featuring">
            <p className="landing-featuring-label">Featuring</p>
            <ul className="landing-logos">
              {PARTNERS.map((p) => (
                <li key={p.name}>
                  <a href={p.site} target="_blank" rel="noreferrer" className="landing-logo">
                    <img
                      src={p.logo.src}
                      alt={p.name}
                      width={p.logo.width}
                      height={p.logo.height}
                      style={{ "--h": p.logo.h } as CSSProperties}
                    />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div ref={cue} className="landing-cue">
        SCROLL TO SEE HOW A DEAL WORKS
        <span ref={cueLine} className="landing-cue-line" />
      </div>

      {!rec && (
        <div className="landing-loader" role="status" aria-label="Loading" aria-hidden={loaded ? true : undefined}>
          {/* The arrows turn over a soft dawn glow while the clip loads, then the whole mark
              opens towards the viewer as the loader fades. */}
          <div className="landing-loader-brand">
            <span className="landing-loader-glow" />
            <LogoMark className="landing-loader-mark" />
            <Wordmark className="landing-loader-word" />
            <span className="landing-loader-bar" />
          </div>
        </div>
      )}
    </div>
  )
}
