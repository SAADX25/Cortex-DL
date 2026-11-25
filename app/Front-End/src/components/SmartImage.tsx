// Resilient thumbnail image with optional blurred backdrop, Meta CDN proxy fallback, and inline SVG fallback.
import React, { useState, useEffect, useRef } from 'react'
import { buildMediaUrl, useMediaEndpoint } from '../lib/mediaEndpoint'

const THUMB_FALLBACK_DATA_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='100%' height='100%' fill='%23081126'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>"

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string

  withBlurBg?: boolean

  bgClassName?: string
}

function isMetaCdnUrl(raw: string): boolean {
  try {
    return /(?:cdninstagram|instagram|fbcdn)\./i.test(new URL(raw, window.location.href).hostname)
  } catch {
    return false
  }
}

const SmartImage: React.FC<SmartImageProps> = ({
  src,
  withBlurBg = false,
  bgClassName = 'dc-thumb-bg',
  alt = '',
  fetchPriority,
  ...rest
}) => {
  const [resolved, setResolved] = useState<{ source?: string; image?: string }>({
    source: src,
    image: src,
  })
  const [bgFailedForSrc, setBgFailedForSrc] = useState<string | null>(null)
  const generation = useRef(0)
  const proxyAttempt = useRef(false)
  const mediaEndpoint = useMediaEndpoint()

  // Bump generation on src change/unmount so late proxy responses for stale URLs are ignored.
  useEffect(() => {
    const reference = generation
    reference.current++
    proxyAttempt.current = false
    setResolved({ source: src, image: src })
    setBgFailedForSrc(null)
    return () => {
      reference.current++
    }
  }, [src])

  const finalSrc = (resolved.source === src ? resolved.image : src) || THUMB_FALLBACK_DATA_URI
  const onImageError = () => {
    const owned = generation.current
    // Meta CDN thumbnails often block direct renderer requests; retry once via the main-process proxy first.
    if (src && isMetaCdnUrl(src) && mediaEndpoint && !proxyAttempt.current) {
      proxyAttempt.current = true
      void window.cortexDl
        .fetchThumbnail(src)
        .then(file => {
          if (generation.current === owned)
            setResolved({ source: src, image: buildMediaUrl(file, mediaEndpoint) })
        })
        .catch(() => {
          if (generation.current === owned)
            setResolved({ source: src, image: THUMB_FALLBACK_DATA_URI })
        })
    } else if (finalSrc !== THUMB_FALLBACK_DATA_URI) {
      setResolved({ source: src, image: THUMB_FALLBACK_DATA_URI })
    }
  }

  if (withBlurBg) {
    return (
      <>
        {bgFailedForSrc !== finalSrc && (
          <img
            src={finalSrc}
            alt=""
            className={bgClassName}
            loading="lazy"
            referrerPolicy="no-referrer"
            aria-hidden="true"
            onError={() => setBgFailedForSrc(finalSrc)}
          />
        )}

        <img
          src={finalSrc}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={onImageError}
          {...rest}
          {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
        />
      </>
    )
  }

  return (
    <img
      src={finalSrc}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={onImageError}
      {...rest}
      {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
    />
  )
}

export default SmartImage
