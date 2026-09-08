/**
 * The widget ships its own CSS injected once, scoped under `.cm-`. An embeddable widget
 * cannot require the host app to run Tailwind or to import a stylesheet; Tailwind is for
 * the demo page only.
 *
 * Every colour is a custom property on `.cm-root`, with the dark set on `.cm-root.cm-dark`.
 * A host that wants a third look overrides the properties; that is the whole theming API.
 */
const CSS = `
.cm-root {
  --cm-bg: #eef2f6;
  --cm-panel: #ffffff;
  --cm-panel-2: #f8fafc;
  --cm-text: #0f172a;
  --cm-muted: #64748b;
  --cm-faint: #94a3b8;
  --cm-line: #e2e8f0;
  --cm-line-2: #cbd5e1;
  --cm-accent: #2563eb;
  --cm-accent-text: #1d4ed8;
  --cm-accent-soft: #eff6ff;
  --cm-accent-ring: #bfdbfe;
  --cm-danger: #b91c1c;
  --cm-danger-soft: #fef2f2;
  --cm-danger-soft-2: #fee2e2;
  --cm-chip: rgba(255, 255, 255, 0.92);
  --cm-chip-on: #0f172a;
  --cm-chip-on-text: #ffffff;
  --cm-shadow: 0 8px 28px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.06);
  --cm-shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.16);

  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  touch-action: none;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--cm-text);
  color-scheme: light;
  -webkit-font-smoothing: antialiased;
}
.cm-root.cm-dark {
  --cm-bg: #0b1020;
  --cm-panel: #161c2e;
  --cm-panel-2: #1e2538;
  --cm-text: #e7ecf6;
  --cm-muted: #9aa6bf;
  --cm-faint: #6b7794;
  --cm-line: #2a3348;
  --cm-line-2: #3b465e;
  --cm-accent: #60a5fa;
  --cm-accent-text: #93c5fd;
  --cm-accent-soft: rgba(96, 165, 250, 0.14);
  --cm-accent-ring: rgba(96, 165, 250, 0.35);
  --cm-danger: #fca5a5;
  --cm-danger-soft: rgba(239, 68, 68, 0.14);
  --cm-danger-soft-2: rgba(239, 68, 68, 0.24);
  --cm-chip: rgba(22, 28, 46, 0.92);
  --cm-chip-on: #e7ecf6;
  --cm-chip-on-text: #0b1020;
  --cm-shadow: 0 10px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08);
  --cm-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06);
  color-scheme: dark;
}
.cm-root canvas { display: block; outline: none; }

.cm-hint {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--cm-chip);
  box-shadow: var(--cm-shadow-sm);
  color: var(--cm-muted);
  white-space: nowrap;
  pointer-events: none;
}

/* zone name that follows the hover, sitting just above the anchor */
.cm-zone {
  transform: translateY(-26px);
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--cm-chip-on);
  color: var(--cm-chip-on-text);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  box-shadow: var(--cm-shadow-sm);
  pointer-events: none;
}

.cm-pop {
  transform: translateY(-64px);
  width: 208px;
  padding: 10px;
  border-radius: 12px;
  background: var(--cm-panel);
  box-shadow: var(--cm-shadow);
  user-select: none;
}
.cm-pop::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--cm-panel);
}
.cm-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.01em;
}
.cm-x {
  border: 0;
  background: none;
  padding: 0 2px;
  cursor: pointer;
  color: var(--cm-faint);
  font-size: 15px;
  line-height: 1;
}
.cm-x:hover { color: var(--cm-text); }

.cm-sev {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.cm-sev button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--cm-line);
  border-radius: 8px;
  background: var(--cm-panel);
  font: inherit;
  font-size: 12px;
  color: var(--cm-text);
  cursor: pointer;
  text-transform: capitalize;
}
.cm-sev button:hover { border-color: var(--cm-line-2); background: var(--cm-panel-2); }
.cm-sev button[aria-pressed="true"] {
  border-color: var(--cm-accent);
  background: var(--cm-accent-soft);
  color: var(--cm-accent-text);
  font-weight: 600;
}
.cm-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}

.cm-note {
  width: 100%;
  margin-top: 8px;
  padding: 6px 8px;
  border: 1px solid var(--cm-line);
  border-radius: 8px;
  background: var(--cm-panel);
  color: var(--cm-text);
  font: inherit;
  font-size: 12px;
  box-sizing: border-box;
  resize: none;
}
.cm-note:focus { outline: 2px solid var(--cm-accent-ring); outline-offset: -1px; border-color: var(--cm-accent); }

.cm-del {
  width: 100%;
  margin-top: 6px;
  padding: 5px;
  border: 0;
  border-radius: 8px;
  background: var(--cm-danger-soft);
  color: var(--cm-danger);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cm-del:hover { background: var(--cm-danger-soft-2); }

/* ── scenario builder ─────────────────────────────────────────────── */

.cm-bar {
  position: absolute;
  left: 10px;
  right: 10px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  pointer-events: none;
}
.cm-bar-top { top: 10px; }
.cm-bar-bottom { bottom: 10px; }

.cm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: auto;
}

.cm-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 0;
  border-radius: 999px;
  background: var(--cm-chip);
  box-shadow: var(--cm-shadow-sm);
  font: inherit;
  font-size: 12px;
  color: var(--cm-text);
  cursor: pointer;
  pointer-events: auto;
  white-space: nowrap;
  backdrop-filter: blur(6px);
}
.cm-chip:hover { background: var(--cm-panel); }
.cm-chip[aria-pressed="true"] {
  background: var(--cm-chip-on);
  color: var(--cm-chip-on-text);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
.cm-role-insured { background: #2563eb; }
.cm-role-other { background: #f59e0b; }

.cm-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  color: #fff;
  font: 600 11px/1.5 system-ui, sans-serif;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.3);
  white-space: nowrap;
}
.cm-tag-n {
  display: inline-block;
  min-width: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  text-align: center;
  font-size: 10px;
}
.cm-chip .cm-tag-n { background: rgba(127, 140, 170, 0.22); color: inherit; }
.cm-chip[aria-pressed="true"] .cm-tag-n { background: rgba(127, 140, 170, 0.35); }

.cm-panel {
  position: absolute;
  top: 52px;
  right: 10px;
  width: 196px;
  padding: 10px;
  border-radius: 12px;
  background: var(--cm-panel);
  box-shadow: var(--cm-shadow);
}
.cm-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 12px;
}

.cm-field {
  display: block;
  margin-bottom: 7px;
  font-size: 11px;
  color: var(--cm-muted);
}
.cm-field select {
  display: block;
  width: 100%;
  margin-top: 3px;
  padding: 5px 6px;
  border: 1px solid var(--cm-line);
  border-radius: 8px;
  background: var(--cm-panel);
  font: inherit;
  font-size: 12px;
  color: var(--cm-text);
}

.cm-hintline {
  margin: 0 0 7px;
  font-size: 11px;
  color: var(--cm-faint);
}

.cm-btn {
  width: 100%;
  margin-top: 5px;
  padding: 6px;
  border: 1px solid var(--cm-line);
  border-radius: 8px;
  background: var(--cm-panel);
  font: inherit;
  font-size: 12px;
  color: var(--cm-text);
  cursor: pointer;
}
.cm-btn:hover { background: var(--cm-panel-2); }
.cm-btn-primary {
  border-color: var(--cm-chip-on);
  background: var(--cm-chip-on);
  color: var(--cm-chip-on-text);
}
.cm-btn-primary:hover { background: var(--cm-chip-on); opacity: 0.9; }

.cm-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--cm-bg);
}
.cm-overlay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  background: var(--cm-panel);
  box-shadow: var(--cm-shadow-sm);
  font-weight: 600;
  font-size: 12px;
}
.cm-overlay-head .cm-btn { width: auto; margin: 0; padding: 6px 14px; }
.cm-overlay-body { position: relative; flex: 1; min-height: 0; }

.cm-impact {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #dc2626;
  color: #fff;
  font: 700 14px/1 system-ui, sans-serif;
  /* white ring so it reads against both asphalt and paintwork */
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.35), 0 0 0 3px rgba(255, 255, 255, 0.92);
}
`

let done = false

export function injectStyle() {
  if (done || typeof document === 'undefined') return
  done = true
  const el = document.createElement('style')
  el.dataset.claimMarker = ''
  el.textContent = CSS
  document.head.appendChild(el)
}
