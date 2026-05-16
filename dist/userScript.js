// SENTINEL-TV — Phase 0 spike userscript v0.0.2
// Runs at document_start in TizenBrew's WebView (evaluateScriptOnDocumentStart: true).
//
// Sends events via Image() beacons (bypass mixed-content / CSP on Tizen WebView)
// AND fetch (when permitted). At least one of them should get through.

(function () {
  'use strict';

  const SERVER = 'http://192.168.1.216:9999';
  const TAG = '[sentinel-spike]';

  // ── helpers ──────────────────────────────────────────────────────────

  function beacon(path, payload) {
    // Image-based GET ping. HTTPS pages can still load HTTP images on most
    // older WebViews (and CSP `img-src` is usually permissive).
    try {
      const img = new Image();
      const q = encodeURIComponent(JSON.stringify(payload).slice(0, 1500));
      img.src = SERVER + path + '?p=' + q + '&t=' + Date.now();
    } catch (_) {}
  }

  function post(path, payload) {
    try {
      fetch(SERVER + path, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => beacon(path, payload));
    } catch (_) {
      beacon(path, payload);
    }
  }

  function readVideoId() {
    const m = location.href.match(/[?&]v=([\w-]{6,})/);
    if (m) return m[1];
    try {
      const node = document.querySelector('ytlr-watch-page, ytlr-video-renderer, [video-id]');
      if (node) return node.getAttribute('video-id') || node.id || null;
    } catch (_) {}
    return null;
  }

  // ── 1. Boot — fire BOTH transports immediately, regardless of DOM state.
  beacon('/boot', { v: '0.0.2', href: location.href, ua: navigator.userAgent, ts: Date.now() });
  post('/boot', { v: '0.0.2', href: location.href, ua: navigator.userAgent, ts: Date.now() });
  console.log(TAG, 'loaded — posting to', SERVER);

  // ── 2. Everything that needs document.body waits for DOM.
  function setupAfterDOM() {
    try {
      setInterval(() => {
        post('/heartbeat', {
          href: location.href,
          videoId: readVideoId(),
          title: document.title,
          ts: Date.now(),
        });
      }, 5000);

      let lastHref = location.href;
      setInterval(() => {
        if (location.href !== lastHref) {
          post('/route', { from: lastHref, to: location.href, ts: Date.now() });
          lastHref = location.href;
        }
      }, 500);

      if (document.body) {
        let mutationCount = 0;
        const observer = new MutationObserver((m) => { mutationCount += m.length; });
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(() => {
          if (mutationCount > 0) {
            post('/mutation', { count: mutationCount, href: location.href, ts: Date.now() });
            mutationCount = 0;
          }
        }, 1000);
      }
    } catch (e) {
      beacon('/setup-error', { msg: String(e && e.message || e), ts: Date.now() });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAfterDOM);
  } else {
    setupAfterDOM();
  }
})();
