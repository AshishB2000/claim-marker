/**
 * The colours the canvas needs. Everything DOM-side is a CSS custom property on `.cm-root`
 * (see style.ts); these are the few that WebGL cannot read from CSS — the clear colour, the
 * scenario's ground and asphalt, the grid.
 */
export type Theme = 'light' | 'dark'

export type ThemeColors = {
  bg: string
  ground: string
  asphalt: string
  paint: string
  grid: string
  section: string
  /** selection ring and pending pin */
  accent: string
  /** contact shadow under the marker's car */
  shadow: string
}

export const THEME: Record<Theme, ThemeColors> = {
  light: {
    bg: '#eef2f6',
    ground: '#dbe2e7',
    asphalt: '#5b636f',
    paint: '#eef2f6',
    grid: '#b6c0cc',
    section: '#94a3b8',
    accent: '#2563eb',
    shadow: '#1e293b',
  },
  dark: {
    bg: '#0b1020',
    ground: '#141a29',
    asphalt: '#3a4354',
    paint: '#d6dde8',
    grid: '#232b3d',
    section: '#33405a',
    accent: '#60a5fa',
    shadow: '#000000',
  },
}

export const themeClass = (theme: Theme, className?: string) =>
  ['cm-root', theme === 'dark' ? 'cm-dark' : '', className ?? ''].filter(Boolean).join(' ')
