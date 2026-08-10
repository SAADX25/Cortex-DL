import React from 'react'

/** YouTube Music icon — a play button inside a circle */
export const YouTubeMusicIcon: React.FC<{ size?: number } & React.SVGProps<SVGSVGElement>> = ({ size = 22, ...props }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 8.5 L15.5 12 L10.5 15.5 Z" fill="currentColor" />
    </svg>
  )
}

export default YouTubeMusicIcon
