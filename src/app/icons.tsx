/** inline SVG icons, one object so call sites read as `Icon.check` */
const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const Icon = {
  check: () => (
    <svg {...icon}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  pin: () => (
    <svg {...icon}>
      <path d="M12 21s-6-5.2-6-10.5a6 6 0 0 1 12 0C18 15.8 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </svg>
  ),
  locate: () => (
    <svg {...icon}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="8" />
    </svg>
  ),
  plus: () => (
    <svg {...icon}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  x: () => (
    <svg {...icon}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  back: () => (
    <svg {...icon}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  next: () => (
    <svg {...icon}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  download: () => (
    <svg {...icon}>
      <path d="M12 3v12M6 11l6 6 6-6M4 21h16" />
    </svg>
  ),
  layers: () => (
    <svg {...icon}>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  ),
  target: () => (
    <svg {...icon}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M7 12h10" />
    </svg>
  ),
  car: () => (
    <svg {...icon}>
      <path d="M5 17h14M6 17l1.5-6h9L18 17M4 11l2-5h12l2 5" />
      <circle cx="7.5" cy="17" r="1.5" />
      <circle cx="16.5" cy="17" r="1.5" />
    </svg>
  ),
  spinner: () => (
    <svg {...icon} className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  ),
  play: () => (
    <svg {...icon}>
      <path d="M7 5v14l11-7z" />
    </svg>
  ),
  stop: () => (
    <svg {...icon}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  rotate: () => (
    <svg {...icon}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  ),
  wand: () => (
    <svg {...icon}>
      <path d="m5 19 10-10" />
      <path d="M16 3v4M14 5h4M18 13v3M16.5 14.5h3M8 3v2M7 4h2" />
      <path d="m14 4 6 6-9 9-6-6z" />
    </svg>
  ),
  pen: () => (
    <svg {...icon}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  camera: () => (
    <svg {...icon}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  person: () => (
    <svg {...icon}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  shield: () => (
    <svg {...icon}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
    </svg>
  ),
  collision: () => (
    <svg {...icon}>
      <path d="M3 12h7M8 9l3 3-3 3" />
      <path d="M21 12h-7M16 9l-3 3 3 3" />
    </svg>
  ),
  pole: () => (
    <svg {...icon}>
      <path d="M17 3v18M14 21h6" />
      <path d="M3 15h8l-2-4H5z" />
      <circle cx="5" cy="17" r="1.5" />
      <circle cx="9" cy="17" r="1.5" />
    </svg>
  ),
  parked: () => (
    <svg {...icon}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
    </svg>
  ),
  lock: () => (
    <svg {...icon}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  spray: () => (
    <svg {...icon}>
      <path d="M8 9h6v12H8zM10 9V6h2v3M15 4l2-2M16 7h3M14 3v-1" />
    </svg>
  ),
  cloud: () => (
    <svg {...icon}>
      <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a3.5 3.5 0 0 1 0 7z" />
      <path d="M8 21l1-2M12 21l1-2M16 21l1-2" />
    </svg>
  ),
  glass: () => (
    <svg {...icon}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5l-2 5 3 2-2 5" />
    </svg>
  ),
  flame: () => (
    <svg {...icon}>
      <path d="M12 3s5 4 5 10a5 5 0 0 1-10 0c0-3 2-4 2-4s0 3 2 3c0-4 1-6 1-9z" />
    </svg>
  ),
}
