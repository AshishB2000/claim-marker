/**
 * The demo portal, all three pages of it. One file because these pages are served with
 * `script-src 'self'` and an inline script would need its hash in the header.
 *
 * Sign in as a sample customer (the server mints the session), mount the report with the
 * token and the prefill, then show the claim number the API answered with.
 */
;(function () {
  var KEY = 'acme-demo'
  /** where the claims desk looks for its token, for this tab only */
  var DESK_KEY = 'claim-marker/desk-token'

  var session = null
  try {
    session = JSON.parse(sessionStorage.getItem(KEY))
  } catch {
    session = null
  }

  // ── 1. sign in ──────────────────────────────────────────────────────

  var buttons = document.querySelectorAll('[data-customer]')
  for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', signIn)

  function signIn(e) {
    var button = e.currentTarget
    button.disabled = true
    fetch('login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customer: button.getAttribute('data-customer') }) })
      .then(function (res) {
        if (!res.ok) throw new Error('Signing in answered ' + res.status + '. Is the server running with DEMO=1?')
        return res.json()
      })
      .then(function (s) {
        sessionStorage.setItem(KEY, JSON.stringify(s))
        location.href = 'policy.html'
      })
      .catch(function (err) {
        button.disabled = false
        say(err.message)
      })
  }

  // ── 2. the policy page, with the report embedded in it ──────────────

  if (document.getElementById('report')) {
    if (!session) location.replace('./')
    else {
      var reporter = (session.prefill && session.prefill.reporter) || {}
      var vehicles = (session.prefill && session.prefill.vehicles) || []
      set('who', reporter.name || '')
      set('policy', reporter.policy || '')
      var list = document.getElementById('vehicles')
      for (var v = 0; v < vehicles.length; v++) {
        var item = document.createElement('li')
        item.textContent = [vehicles[v].year, vehicles[v].make, vehicles[v].model].join(' ') + (vehicles[v].plate ? ' · ' + vehicles[v].plate : '')
        list.appendChild(item)
      }
      // the same four lines docs/integration.md gives an insurer, with the token and the
      // prefill this portal's own backend just handed us
      ClaimMarker.mount('#report', {
        url: '/',
        submitUrl: '/claims',
        token: session.token,
        brand: 'Acme Mutual',
        prefill: session.prefill,
        onSubmitted: function (e) {
          location.href = 'claims.html#' + encodeURIComponent(e.reference)
        },
        onQueued: function () {
          say('No signal. Your report is saved on your phone and sends itself when you are back in coverage.')
        },
      })
    }
  }

  // ── 3. the claim number, and the desk the report landed on ──────────

  if (document.getElementById('reference')) {
    var reference = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (!reference) location.replace('./')
    set('reference', reference)
    document.getElementById('desk').href = '/adjuster.html#/' + encodeURIComponent(reference)
    if (session) {
      // the visitor's own session opens the report they filed and nothing else; the desk asks
      // for a token once per tab, and this saves them typing it
      try {
        sessionStorage.setItem(DESK_KEY, session.token)
      } catch {
        // a browser with storage turned off: the desk will ask for the token instead
      }
      set('token', session.token)
    }
  }

  function set(id, text) {
    var el = document.getElementById(id)
    if (el) el.textContent = text
  }
  function say(text) {
    var el = document.getElementById('banner')
    if (!el) return
    el.textContent = text
    el.hidden = false
  }
})()
