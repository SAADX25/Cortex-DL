/**
 * SmartImage — Shared thumbnail component
 *
 * Handles:
 * - Instagram CDN thumbnails via local proxy (fetchThumbnail IPC)
 * - Fallback SVG when image fails to load
 * - Optional thumbPort for streaming from local media server
 */
import React, { useState, useEffect } from 'react'

const THUMB_FALLBACK_DATA_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='100%' height='100%' fill='%23081126'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>"

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Remote URL of the thumbnail (can be Instagram CDN) */
  src?: string
  /** Optional port for the local media-server proxy */
  thumbPort?: number
  /** Whether to render a blurred background layer (used in DownloadCard) */
  withBlurBg?: boolean
  /** CSS class for the blurred background layer */
  bgClassName?: string
}

/**
 * A drop-in <img> replacement that:
 * - Proxies Instagram CDN images through the local thumbnail server
 * - Shows a fallback SVG on error
 * - Optionally renders a blurred background copy of the image
 */
const SmartImage: React.FC<SmartImageProps> = ({
  src,
  thumbPort,
  withBlurBg = false,
  bgClassName = 'dc-thumb-bg',
  alt = '',
  ...rest
}) => {
  const [imgSrc, setImgSrc] = useState<string | undefined>(src)
  const [resolvedPort, setResolvedPort] = useState<number>(thumbPort ?? 3345)

  // Resolve thumb port from IPC if not provided via prop
  useEffect(() => {
    if (thumbPort != null) {
      setResolvedPort(thumbPort)
      return
    }
    if (window.cortexDl?.getMediaPort) {
      window.cortexDl.getMediaPort().then((port) => setResolvedPort(port)).catch(() => {})
    }
  }, [thumbPort])

  // Proxy Instagram CDN URLs through local thumbnail server
  useEffect(() => {
    let cancelled = false
    setImgSrc(src)

    if (src && /instagram|cdninstagram/i.test(src)) {
      ;(async () => {
        try {
          const filePath = await window.cortexDl.fetchThumbnail(src)
          if (!cancelled && filePath) {
            const streamUrl = `http://127.0.0.1:${resolvedPort}/?path=${encodeURIComponent(filePath)}`
            setImgSrc(streamUrl)
          }
        } catch {
          // Silently fall back to original src
        }
      })()
    }

    return () => {
      cancelled = true
    }
  }, [src, resolvedPort])

  const finalSrc = imgSrc || THUMB_FALLBACK_DATA_URI

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
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.onerror = null
            e.currentTarget.src = THUMB_FALLBACK_DATA_URI
          }}
          {...rest}
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
      onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.onerror = null
        e.currentTarget.src = THUMB_FALLBACK_DATA_URI
      }}
      {...rest}
    />
  )
}

export default SmartImage
