/**
 * claim-marker embed — the one script an insurer's site needs.
 *
 *   <div id="report"></div>
 *   <script src="https://claims.example.com/embed.js"></script>
 *   <script>
 *     ClaimMarker.mount('#report', {
 *       url: 'https://claims.example.com/',          // where the page is hosted
 *       submitUrl: 'https://api.example.com/claims', // where the document is POSTed
 *       token: session.claimToken,                   // short-lived, minted by your backend
 *       brand: 'Acme Mutual',
 *       prefill: { reporter: { name, phone, email, policy }, vehicles: [{ make, model, year, plate, vin, color }] },
 *       onSubmitted: function (e) { location.href = '/claims/' + e.reference },
 *     })
 *   </script>
 *
 * The page runs in an iframe, so nothing here touches your CSS or your JavaScript, and the
 * customer's photographs never pass through your page. This script tells the iframe its
 * configuration once the page says it is ready, sizes the iframe to the page so there is no
 * inner scrollbar, and relays what happens: each step, the report sent, or the report kept
 * for when the phone is back in coverage. Messages are checked against the iframe's own
 * window and origin, and nothing else on the page can pretend to be it.
 *
 * Plain script, no build step, works in every browser the page itself does.
 */
;(function () {
  var CHANNEL = 'claim-marker'
  var SETTINGS = ['submitUrl', 'token', 'brand', 'fraudNotice', 'assistUrl', 'prefill', 'returnDocument']

  function pick(opts) {
    var config = {}
    for (var i = 0; i < SETTINGS.length; i++) if (opts[SETTINGS[i]] !== undefined) config[SETTINGS[i]] = opts[SETTINGS[i]]
    return config
  }

  function mount(target, opts) {
    opts = opts || {}
    var el = typeof target === 'string' ? document.querySelector(target) : target
    if (!el) throw new Error('claim-marker: nothing to mount on for ' + target)
    if (!opts.url) throw new Error('claim-marker: opts.url is where the page is hosted')

    var url = new URL(opts.url, location.href)
    var origin = url.origin
    var config = pick(opts)

    var iframe = document.createElement('iframe')
    iframe.src = url.href
    iframe.title = opts.title || 'Report an accident'
    iframe.style.cssText = 'display:block;width:100%;border:0;min-height:' + (opts.minHeight || 640) + 'px'
    // the page asks for the customer's location, their camera for photos and the microphone to dictate
    iframe.setAttribute('allow', 'geolocation; camera; microphone')
    iframe.setAttribute('scrolling', 'no')

    function send(type, extra) {
      var m = { source: CHANNEL + '-host', type: type }
      for (var k in extra) m[k] = extra[k]
      iframe.contentWindow.postMessage(m, origin)
    }

    function onMessage(e) {
      if (e.source !== iframe.contentWindow || e.origin !== origin) return
      var m = e.data
      if (!m || m.source !== CHANNEL) return
      if (m.type === 'ready') send('config', { config: config })
      else if (m.type === 'height') {
        if (opts.autoHeight !== false) iframe.style.height = Math.ceil(m.height) + 'px'
      } else if (m.type === 'step' && opts.onStep) opts.onStep(m)
      else if (m.type === 'submitted' && opts.onSubmitted) opts.onSubmitted(m)
      else if (m.type === 'queued' && opts.onQueued) opts.onQueued(m)
    }

    window.addEventListener('message', onMessage)
    el.appendChild(iframe)

    return {
      iframe: iframe,
      /** change settings after mounting, for example a renewed token */
      update: function (next) {
        var patch = pick(next || {})
        for (var k in patch) config[k] = patch[k]
        send('config', { config: config })
      },
      unmount: function () {
        window.removeEventListener('message', onMessage)
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      },
    }
  }

  window.ClaimMarker = { mount: mount, version: '1' }
})()
