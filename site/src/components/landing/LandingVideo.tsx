'use client'

import { Play, RotateCcw } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const COMPACT_VIEWPORT_QUERY = '(max-width: 700px)'

type LandingVideoBehavior = 'auto-once' | 'click'
type LandingVideoState =
  | 'poster'
  | 'loading'
  | 'playing'
  | 'ended'
  | 'blocked'
  | 'error'

type LandingVideoProps = {
  behavior: LandingVideoBehavior
  caption: string
  label: string
  playLabel: string
  poster: string
  src: string
  variant: 'how' | 'agent'
}

function subscribeToMediaQuery(query: string, onChange: () => void) {
  const mediaQuery = window.matchMedia(query)
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}

function getMediaQuerySnapshot(query: string) {
  return window.matchMedia(query).matches
}

function getServerMediaQuerySnapshot() {
  return false
}

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToMediaQuery(query, onChange),
    [query],
  )
  const getSnapshot = useCallback(() => getMediaQuerySnapshot(query), [query])

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerMediaQuerySnapshot,
  )
}

/**
 * Real Shelf footage with deliberately conservative loading behavior.
 * Auto footage loads near its section and plays once on larger screens.
 * Click footage, compact screens, and reduced-motion users keep the poster
 * until the visitor asks to play.
 */
export function LandingVideo({
  behavior,
  caption,
  label,
  playLabel,
  poster,
  src,
  variant,
}: LandingVideoProps) {
  const captionId = useId()
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const autoPlayStarted = useRef(false)
  const reduceMotion = useMediaQuery(REDUCED_MOTION_QUERY)
  const compactViewport = useMediaQuery(COMPACT_VIEWPORT_QUERY)
  const requiresInteraction = behavior === 'click' || reduceMotion || compactViewport
  const [sourceReady, setSourceReady] = useState(false)
  const [playRequest, setPlayRequest] = useState(0)
  const [userInitiated, setUserInitiated] = useState(false)
  const [state, setState] = useState<LandingVideoState>('poster')

  useEffect(() => {
    if (behavior !== 'auto-once' || requiresInteraction || autoPlayStarted.current) {
      return
    }

    const frame = frameRef.current
    if (!frame) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || autoPlayStarted.current) return
        autoPlayStarted.current = true
        setState('loading')
        setSourceReady(true)
        setPlayRequest((request) => request + 1)
        observer.disconnect()
      },
      { rootMargin: '200px 0px', threshold: 0.35 },
    )

    observer.observe(frame)
    return () => observer.disconnect()
  }, [behavior, requiresInteraction])

  useEffect(() => {
    if (!sourceReady || playRequest === 0) return

    const video = videoRef.current
    if (!video) return

    let cancelled = false
    const startPlayback = () => {
      if (cancelled) return
      video.currentTime = 0
      void video.play().catch(() => {
        if (cancelled) return
        autoPlayStarted.current = false
        setState('blocked')
      })
    }

    video.load()
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      startPlayback()
    } else {
      video.addEventListener('canplay', startPlayback, { once: true })
    }

    return () => {
      cancelled = true
      video.removeEventListener('canplay', startPlayback)
    }
  }, [playRequest, sourceReady])

  function requestPlayback() {
    setUserInitiated(true)
    setState('loading')
    setSourceReady(true)
    setPlayRequest((request) => request + 1)
  }

  const showControl =
    (requiresInteraction && state === 'poster') ||
    state === 'blocked' ||
    state === 'ended' ||
    state === 'error'
  const buttonText =
    state === 'ended' ? 'Replay demo' : state === 'error' ? 'Try video again' : playLabel

  return (
    <figure className="landing-video" data-variant={variant} data-state={state}>
      <div className="landing-video-frame" ref={frameRef}>
        <video
          ref={videoRef}
          aria-describedby={captionId}
          aria-label={label}
          controls={userInitiated}
          muted
          onEnded={() => setState('ended')}
          onError={() => setState('error')}
          onPlaying={() => setState('playing')}
          playsInline
          poster={poster}
          preload="none"
          src={sourceReady ? src : undefined}
        >
          Your browser does not support embedded video.
        </video>

        {showControl ? (
          <button
            type="button"
            className="landing-video-control"
            onClick={requestPlayback}
            aria-label={buttonText}
          >
            {state === 'ended' ? (
              <RotateCcw aria-hidden="true" size={18} strokeWidth={2.2} />
            ) : (
              <Play aria-hidden="true" size={18} strokeWidth={2.2} fill="currentColor" />
            )}
            <span>{buttonText}</span>
          </button>
        ) : null}

        {state === 'loading' ? (
          <span className="landing-video-loading" role="status">
            Loading video
          </span>
        ) : null}
      </div>

      <figcaption id={captionId}>{caption}</figcaption>
      {state === 'error' ? (
        <p className="landing-video-error" role="alert">
          The video could not load. The description above covers the same flow.
        </p>
      ) : null}
    </figure>
  )
}
