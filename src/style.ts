/**
 * The widget ships its own CSS injected once, scoped under `.cm-`. An embeddable widget
 * cannot require the host app to run Tailwind or to import a stylesheet; Tailwind is for
 * the demo page only.
 */
const CSS = `
.cm-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  touch-action: none;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #0f172a;
  -webkit-font-smoothing: antialiased;
}
.cm-root canvas { display: block; outline: none; }

.cm-hint {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
  color: #475569;
  white-space: nowrap;
  pointer-events: none;
}

.cm-pop {
  transform: translateY(-64px);
  width: 208px;
  padding: 10px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.06);
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
  background: #fff;
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
  color: #94a3b8;
  font-size: 15px;
  line-height: 1;
}
.cm-x:hover { color: #0f172a; }

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
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
  text-transform: capitalize;
}
.cm-sev button:hover { border-color: #cbd5e1; background: #f8fafc; }
.cm-sev button[aria-pressed="true"] {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
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
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  box-sizing: border-box;
  resize: none;
}
.cm-note:focus { outline: 2px solid #bfdbfe; outline-offset: -1px; border-color: #93c5fd; }

.cm-del {
  width: 100%;
  margin-top: 6px;
  padding: 5px;
  border: 0;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cm-del:hover { background: #fee2e2; }

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
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.16);
  font: inherit;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
  pointer-events: auto;
  white-space: nowrap;
}
.cm-chip:hover { background: #fff; }
.cm-chip[aria-pressed="true"] {
  background: #0f172a;
  color: #fff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.3);
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
.cm-chip .cm-tag-n { background: rgba(15, 23, 42, 0.12); color: inherit; }
.cm-chip[aria-pressed="true"] .cm-tag-n { background: rgba(255, 255, 255, 0.25); }

.cm-panel {
  position: absolute;
  top: 52px;
  right: 10px;
  width: 196px;
  padding: 10px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.06);
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
  color: #64748b;
}
.cm-field select {
  display: block;
  width: 100%;
  margin-top: 3px;
  padding: 5px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  color: #0f172a;
}

.cm-hintline {
  margin: 0 0 7px;
  font-size: 11px;
  color: #94a3b8;
}

.cm-btn {
  width: 100%;
  margin-top: 5px;
  padding: 6px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  color: #334155;
  cursor: pointer;
}
.cm-btn:hover { background: #f8fafc; }
.cm-btn-primary {
  border-color: #0f172a;
  background: #0f172a;
  color: #fff;
}
.cm-btn-primary:hover { background: #1e293b; }

.cm-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: #eef2f6;
}
.cm-overlay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
  font-weight: 600;
  font-size: 12px;
}
.cm-overlay-head .cm-btn { width: auto; margin: 0; padding: 6px 14px; }
.cm-overlay-body { position: relative; flex: 1; min-height: 0; }
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
