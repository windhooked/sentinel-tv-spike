// SENTINEL-TV — Phase 0 spike userscript.
// Loaded by TizenBrew into the Samsung TV YouTube app.
// Proves four things: fetch out, DOM read, route changes, MutationObserver.
//
// Set SERVER to the dev box's LAN IP + listener port before loading.

(function () {
  'use strict';

  const SERVER = 'http://192.168.1.216:9999';
  const TAG = '[sentinel-spike]';

  // ── 1. Boot event ────────────────────────────────────────────────────
  post('/boot', {
    href: location.href,
    ua: navigator.userAgent,
    ts: Date.now(),
  });

  // ── 2. Heartbeat every 5s with current state ─────────────────────────
  setInterval(() => {
    post('/heartbeat', {
      href: location.href,
      videoId: readVideoId(),
      title: document.title,
      ts: Date.now(),
    });
  }, 5000);

  // ── 3. MutationObserver on document.body ─────────────────────────────
  // Counts mutations in 1-second buckets and reports if non-zero.
  let mutationCount = 0;
  const observer = new MutationObserver((mutations) => {
    mutationCount += mutations.length;
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
  });
  setInterval(() => {
    if (mutationCount > 0) {
      post('/mutation', { count: mutationCount, href: location.href, ts: Date.now() });
      mutationCount = 0;
    }
  }, 1000);

  // ── 4. Route-change hook ─────────────────────────────────────────────
  // YouTube TV is an SPA — listen for history navigation and hashchange.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      post('/route', { from: lastHref, to: location.href, ts: Date.now() });
      lastHref = location.href;
    }
  }, 500);

  // ── helpers ──────────────────────────────────────────────────────────

  function readVideoId() {
    // YouTube TV puts ?v=XXX in the URL on the watch page.
    const m = location.href.match(/[?&]v=([\w-]{6,})/);
    if (m) return m[1];
    // Fallback: look for a known wrapper element.
    const node = document.querySelector('ytlr-watch-page, ytlr-video-renderer, [video-id]');
    if (node) return node.getAttribute('video-id') || node.id || null;
    return null;
  }

  function post(path, payload) {
    try {
      fetch(SERVER + path, {
        method: 'POST',
        mode: 'no-cors', // we don't need the response, just need the request to fly
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch((e) => console.log(TAG, 'fetch error', e));
    } catch (e) {
      console.log(TAG, 'sync error', e);
    }
  }

  console.log(TAG, 'loaded — posting to', SERVER);
})();
