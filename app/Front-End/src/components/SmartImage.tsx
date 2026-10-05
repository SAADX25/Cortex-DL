/**
 * SmartImage — Shared thumbnail component
 *
 * Handles:
 * - Instagram CDN thumbnails via local proxy (fetchThumbnail IPC)
 * - Fallback SVG when image fails to load
 * - Resolves the token-protected local media endpoint on its own
 */
import React, { useState, useEffect, useRef } from 'react'
import { buildMediaUrl, useMediaEndpoint } from '../lib/mediaEndpoint'

const THUMB_FALLBACK_DATA_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='100%' height='100%' fill='%23081126'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>"

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Remote URL of the thumbnail (can be Instagram CDN) */
  src?: string
  /** Whether to render a blurred background layer (used in DownloadCard) */
  withBlurBg?: boolean
  /** CSS class for the blurred background layer */
  bgClassName?: string
}

/**
 * A drop-in <img> replacement that:
 * - Falls back to the local proxy only after a remote CDN load fails
 * - Shows a fallback SVG on error
 * - Optionally renders a blurred background copy of the image
 */
const SmartImage: React.FC<SmartImageProps> = ({
  src,
  withBlurBg = false,
  bgClassName = 'dc-thumb-bg',
  alt = '',
  fetchPriority,
  ...rest
}) => {
  const [resolved, setResolved] = useState<{ source?: string; image?: string }>({ source: src, image: src })
  const generation = useRef(0)
  const proxyAttempt = useRef(false)
  const mediaEndpoint = useMediaEndpoint()

  useEffect(() => {
    const reference = generation
    reference.current++
    proxyAttempt.current = false
    setResolved({ source: src, image: src })
    return () => { reference.current++ }
  }, [src])

  const finalSrc = (resolved.source === src ? resolved.image : src) || THUMB_FALLBACK_DATA_URI
  const onImageError = () => {
    const owned = generation.current
    if (src && /(?:cdninstagram|instagram|fbcdn)\./i.test(new URL(src, window.location.href).hostname) && mediaEndpoint && !proxyAttempt.current) {
      proxyAttempt.current = true
      void window.cortexDl.fetchThumbnail(src).then(file => {
        if (generation.current === owned) setResolved({ source: src, image: buildMediaUrl(file, mediaEndpoint) })
      }).catch(() => {
        if (generation.current === owned) setResolved({ source: src, image: THUMB_FALLBACK_DATA_URI })
      })
    } else if (finalSrc !== THUMB_FALLBACK_DATA_URI) {
      setResolved({ source: src, image: THUMB_FALLBACK_DATA_URI })
    }
  }

  if (withBlurBg) {
    return (
      <>
        {/* Blurred background layer */}
        <img
          src={finalSrc}
          alt=""
          className={bgClassName}
          loading="lazy"
          referrerPolicy="no-referrer"
          aria-hidden="true"
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
        />
        {/* Foreground image */}
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
