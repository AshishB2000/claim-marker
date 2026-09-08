---
description: Run the full verification loop and report the real output
---

Verify this repo the way CLAUDE.md requires, and paste the actual output of each step
rather than summarising it.

1. `npm run lint` — oxlint must be completely silent. Warnings count as failures here.
2. `npm test` — all tests must pass.
3. `npm run build` — must complete, and report the bundle size it prints.
4. If anything in this change touches rendering, dragging, the demo, or either widget's
   public API, also run the end-to-end checks. They need a dev server:
   - start `npm run dev` in the background
   - `node scripts/smoke.mjs`
   - stop the dev server afterwards

   `scripts/smoke.mjs` needs `dangerouslyDisableSandbox: true` — Chromium cannot start
   under the sandbox and fails with a misleading `Permission denied (1100)`.

If a step fails, say so plainly with the failing output and stop; do not describe the work
as done. If you skipped step 4, say which parts of the change went unverified and why.
