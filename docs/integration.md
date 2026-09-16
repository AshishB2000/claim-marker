# Integrating the page

Everything an insurer needs to put "Report an accident" on their own site and receive what
the customer sends. Nothing here needs the page rebuilt: the build is static, the settings
arrive at runtime.

```
  the insurer's portal                the page (static, iframe)             the insurer's backend
  ┌───────────────────┐   config      ┌──────────────────────┐   POST claim/1   ┌──────────────────┐
  │ embed.js          │ ───────────▶  │ seven steps          │ ───────────────▶ │ /claims          │
  │ token + prefill   │ ◀───────────  │ map · 3D · damage    │ ◀─────────────── │ { reference }    │
  │ onSubmitted(...)  │   events      │ outbox when offline  │                  │ webhook, files   │
  └───────────────────┘               └──────────────────────┘                  └──────────────────┘
                                                                                        │
                                                                                        ▼
                                                                                 the claims desk
```

## 0. Deploy it

The quickest whole product is the reference server with the built page beside it: one port,
one origin, no CORS, and the settings read at startup, so the same image serves any insurer.

```bash
docker compose up --build            # http://localhost:8788
```

or without Docker:

```bash
npm run build
DESK_TOKEN=desk-token SESSION_SECRET=$(openssl rand -hex 32) API_KEY=$(openssl rand -hex 32) \
ALLOWED_HOSTS=https://portal.example.com BRAND='Acme Mutual' \
node server/claim-server.mjs         # http://localhost:8788
```

It serves the customer's page at `/`, the claims desk at `/adjuster.html` and the API at
`/claims`, and injects `window.CLAIM_MARKER` into both HTML pages before `</head>` so the
page posts to its own origin and shows your brand without a rebuild. The
Content-Security-Policy is built to match — including the SHA-256 of that one inline script —
with `frame-ancestors` set from `ALLOWED_HOSTS`, hashed assets cached for a year and the HTML
never cached. `dist/lib/` is not served: it is the parser this server validates with.

| variable | what |
| --- | --- |
| `PORT` · `CLAIM_DIR` · `STATIC_DIR` | the port, where reports are filed, where the built page is |
| `CLAIM_TOKEN` | a shared bearer token the page sends. Unset with `SESSION_SECRET` unset too, anything may post. |
| `SESSION_SECRET` · `API_KEY` | per-customer sessions: the HMAC key, and the key your backend calls `/sessions` with |
| `DESK_TOKEN` | what the claims desk sends to read and re-file reports |
| `ALLOWED_HOSTS` | origins allowed to embed the page; sets `frame-ancestors` and the page's own trust list |
| `BRAND` · `ASSIST_URL` | injected into the page |
| `CONNECT_SRC` | extra origins the page may reach — your own tiles or geocoder — added to the CSP |
| `RATE_LIMIT` · `TRUST_PROXY` | POSTs per minute per IP (default 30), and whether to believe `X-Forwarded-For` |
| `WEBHOOK_URL` · `WEBHOOK_SECRET` | where new reports are announced, and the key for the signature |
| `CLAIM_ORIGIN` | an extra origin for CORS. Leave it unset in production: a page served from here needs none. |

With `NODE_ENV=production` the server refuses to start unless `CLAIM_TOKEN` or
`SESSION_SECRET` is set, `DESK_TOKEN` is set, and `CLAIM_ORIGIN` is not `*`. Better a failed
deploy than an open claims inbox.

Hosting the static build behind your own CDN still works — `dist/` is a plain static site —
but then the API, the CSP and the runtime config are yours to arrange.

## 1. Embed it

Host the built page (`npm run build`, then serve `dist/`) at a URL of your own, say
`https://claims.example.com/`. On the page your customer is logged in to:

```html
<div id="report"></div>
<script src="https://claims.example.com/embed.js"></script>
<script>
  ClaimMarker.mount('#report', {
    url: 'https://claims.example.com/',
    submitUrl: 'https://api.example.com/claims',
    token: session.claimToken,
    brand: 'Acme Mutual',
    prefill: {
      reporter: { name: 'Sam Lee', phone: '555 0100', email: 'sam@example.com', policy: 'POL-9', policyholder: true },
      vehicles: [
        { make: 'Toyota', model: 'Camry', year: 2021, plate: 'ABC 123', plateState: 'NY', vin: '4T1BF1FK5CU123456', color: '#b91c1c' },
        { make: 'Ford', model: 'F-150', year: 2020, plate: 'TRK 9' },
      ],
    },
    onStep: (e) => analytics.track('claim step', e),
    onSubmitted: (e) => (location.href = '/claims/' + e.reference),
    onQueued: (e) => console.log('kept for later', e.reference),
  })
</script>
```

The page runs in an iframe: it cannot touch your CSS or scripts, and the customer's
photographs never pass through your page. `embed.js` sizes the iframe to the page (no inner
scrollbar), passes the settings once the page says it is ready, and relays events.

| option | what |
| --- | --- |
| `url` | where the page is hosted |
| `submitUrl` | where the document is POSTed (below) |
| `token` | sent as `Authorization: Bearer …` with the document. Mint a short-lived one per session so your backend knows whose report it is. |
| `brand` | shown under the page title |
| `prefill` | `reporter` and the `vehicles` on the policy. One vehicle fills the card; several become a "which of your vehicles?" pick. Only empty fields are filled; whatever the customer types is theirs. |
| `fraudNotice` | the state-mandated wording above the signature |
| `assistUrl` | an endpoint speaking `claim-assist/1` ([the assistant](spec-app.md#the-assistant)); unset, no AI exists in the page |
| `returnDocument` | include the whole document in the `submitted` event, not just the reference |
| `minHeight`, `autoHeight`, `title` | the iframe's |

Events: `onStep({ step, index, count })` on every step, `onSubmitted({ reference, document? })`
when the server has it, `onQueued({ reference })` when the phone had no signal and the report
is waiting on the device (a `submitted` follows when it leaves). `mount()` returns
`{ iframe, update(settings), unmount() }`; `update({ token })` hands over a renewed token.

**Restrict who may configure the page.** Build with `VITE_ALLOWED_HOSTS=https://www.example.com`
(comma-separated) so only your portal's origin can send settings to the iframe. Unset, any
origin is accepted and the console says so.

**Without an iframe** — hosting the page as a route of your own site — set the same settings
on `window.CLAIM_MARKER` in a `<script>` before the bundle, and `?token=` may carry the token.

## 2. Receive the document

The page POSTs one JSON document, `claim/1`, to `submitUrl`:

```
POST /claims
Content-Type: application/json
Authorization: Bearer <the token you gave the page>
Idempotency-Key: CM-7F3K2Q            ← the page's own reference for this report

{ "schema": "claim/1", "reference": "CM-7F3K2Q", ... }
```

The shape is [claim-1.schema.json](claim-1.schema.json), a JSON Schema any language can
validate with, and the page's own parser is in `dist/lib/claim.js` after a build, for a Node
backend. A document with twelve photographs is a few megabytes; allow 25 MB.

Answer `2xx` with, optionally, your own claim number:

```json
{ "reference": "INS-2026-K7M2PQ" }
```

The page shows that reference to the customer instead of its own. An empty `2xx` is fine.

**What the page does with your answer.** `5xx`, a timeout, no network: it retries three
times with backoff, then keeps the document on the device and sends it when the browser
comes back online or the page next opens. `408`, `429`, `401` and `403` are treated the same
way (the host can renew the token with `update()`). Any other `4xx` is shown to the customer
as a refusal and not retried.

**Idempotency.** The same report can arrive twice — a reply lost on a bad connection, then
the outbox sending again. Key on `Idempotency-Key` (or `reference` in the body): file it once
and answer the second exactly as the first.

**Attachments** are inline data URLs: `attachments.scene` (PNG, the diagram),
`attachments.damage[vehicleId]` (PNG, the marked-up car) and `attachments.photos[].data`
(JPEG, the customer's photographs, already downscaled to 1280 px). Decode them to files on
receipt; the reference server shows how.

## 2b. Sessions: a token that names the customer

A shared `CLAIM_TOKEN` is the same for everyone, so a report arrives with no idea whose it is.
A session token is minted per customer by your backend, at the moment they are already logged
in, and carries their id and policy number:

```bash
curl -X POST https://claims.example.com/sessions \
  -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d '{ "customer": { "id": "cust-1", "policy": "POL-9", "name": "Sam Lee",
                      "phone": "555 0100", "email": "sam@example.com" },
        "vehicles": [ { "make": "Toyota", "model": "Camry", "year": 2021, "plate": "ABC 123" } ],
        "ttlSeconds": 3600 }'

{ "token": "eyJzdWIiOi…", "expiresAt": "2026-09-16T04:02:47.000Z",
  "prefill": { "reporter": { … }, "vehicles": [ … ] } }
```

Hand both straight to the embed: `ClaimMarker.mount('#report', { token, prefill, … })`. The
report is then filed with `customer: { id, policy }` on its receipt and in the webhook.

The token is `base64url(payload).base64url(hmac-sha256)` where the payload is
`{ sub, policy, exp }` and `exp` is an epoch second, so your own backend can verify or mint
one with six lines and no library — `server/session.mjs` is those six lines. It is
deliberately not a JWT: a JWT carries its algorithm in the token, and an algorithm in the
token is how `alg: none` happens. The lifetime is clamped to between a minute and a day.

An expired or tampered token is `401`, which the page treats as "wait and retry" rather than
a refusal, so the host can renew it with `widget.update({ token })` and the queued report
leaves on the next attempt. `/sessions` is server-to-server: it wants `x-api-key`, and a
request that carries an `Origin` header — which a browser always does — is refused with `403`.

**Rate limiting.** `POST /claims` and `POST /sessions` are limited to `RATE_LIMIT` a minute
per IP (default 30) and answer `429` with `Retry-After: 60` above that. The page already
treats `429` as an outage, so a limited report waits in the outbox rather than being lost.

## 3. The reference server

`server/claim-server.mjs` is a complete receiving end in one file with no dependencies, to
run as is or to copy from:

```bash
npm run build
CLAIM_TOKEN=customer-token DESK_TOKEN=desk-token \
WEBHOOK_URL=https://hooks.example.com/claims WEBHOOK_SECRET=s3cret \
node server/claim-server.mjs                     # http://localhost:8788
```

It validates each document with the page's parser, files it under `data/claims/<reference>/`
as `claim.json` plus `scene.png`, `damage-a.png`, `photo-01.jpg`…, answers with its own
reference, dedupes on the idempotency key, and serves `GET /claims`, `GET /claims/:ref`,
`GET /claims/:ref/files/:name` and `PATCH /claims/:ref { status }` to the desk.

**The webhook.** With `WEBHOOK_URL` set, each new report is announced:

```
POST <WEBHOOK_URL>
X-Claim-Event: claim.received
X-Claim-Signature: sha256=<HMAC-SHA256 of the raw body, keyed by WEBHOOK_SECRET>

{ "event": "claim.received", "reference": "INS-2026-K7M2PQ", "clientReference": "CM-7F3K2Q",
  "receivedAt": "...", "claim": { ...the document without attachments... },
  "files": { "scene": "https://.../claims/INS-2026-K7M2PQ/files/scene.png", ... } }
```

Verify it before trusting it:

```js
// Node
const ok = crypto.timingSafeEqual(
  Buffer.from(req.headers['x-claim-signature']),
  Buffer.from('sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')),
)
```

```python
# Python
expected = 'sha256=' + hmac.new(SECRET, raw_body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(request.headers['X-Claim-Signature'], expected)
```

Delivery is retried three times; make the receiver idempotent on `reference`.

## 4. The claims desk

`adjuster.html` (in the same build) lists what the server has and opens each report as the
document it was sent as: the map with playback, the marked-up car, the photographs,
printable to PDF, with a status the desk moves along. It reads the server's API at
`VITE_CLAIMS_API` (build-time) or `?api=` (for a desk pointed elsewhere), and asks for the
desk token once per tab.

A claims system with its own inbox does not need it: `ReportDocument` in
`src/app/ReportDocument.tsx` renders a `claim/1` document from wherever you keep the JSON.

## 5. Proving it

`node scripts/integration-smoke.mjs` (with `npm run dev` running and one `npm run build`
done) runs the whole thing: a host page embedding the report with a token and prefill, the
customer picking a policy vehicle, sending with no signal and the report leaving by itself
when the signal returns, the server filing it with the files unpacked, a resend filed once,
the webhook's signature verifying, and the desk opening it and changing its status. It also
mints a session and hands its token and prefill to the embed, proves an expired or forged one
is refused, floods the server until it answers `429`, and checks the built page is served
with its CSP, its injected config and immutable assets — with `dist/lib` and anything outside
`dist/` unreachable.
