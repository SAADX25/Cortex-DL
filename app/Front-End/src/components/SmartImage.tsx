/**
 * SmartImage — Shared thumbnail component
 *
 * Handles:
 * - Instagram CDN thumbnails via local proxy (fetchThumbnail IPC)
 * - Fallback SVG when image fails to load
 * - Resolves the token-protected local media endpoint on its own
 */
import React, { useState, useEffect } from 'react'
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
 * - Proxies Instagram CDN images through the local thumbnail server
 * - Shows a fallback SVG on error
 * - Optionally renders a blurred background copy of the image
 */
const SmartImage: React.FC<SmartImageProps> = ({
  src,
  withBlurBg = false,
  bgClassName = 'dc-thumb-bg',
  alt = '',
  ...rest
}) => {
  const [imgSrc, setImgSrc] = useState<string | undefined>(src)
  const mediaEndpoint = useMediaEndpoint()

  // Proxy Instagram CDN URLs through local thumbnail server
  useEffect(() => {
    let cancelled = false
    setImgSrc(src)

    if (src && /instagram|cdninstagram/i.test(src) && mediaEndpoint) {
      ;(async () => {
        try {
          const filePath = await window.cortexDl.fetchThumbnail(src)
          if (!cancelled && filePath) {
            setImgSrc(buildMediaUrl(filePath, mediaEndpoint))
          }
        } catch {
          // Silently fall back to original src
        }
      })()
    }

    return () => {
      cancelled = true
    }
  }, [src, mediaEndpoint])

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
