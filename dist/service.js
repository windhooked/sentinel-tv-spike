// SENTINEL-TV — Phase 0 spike service (Tizen background service).
// Runs in TizenBrew's Node-style VM sandbox when the spike module is launched.
// Has `require`, `tizen` globals, but NO DOM (no document/window/MutationObserver).
//
// Goal: prove network reachability from the TV to the dev-box listener.
// DOM-side checks (videoId, mutations, route) remain in dist/userScript.js
// and only run if/when TizenBrew's CDP injection succeeds.

(function () {
  'use strict';

  var http = require('http');
  var SERVER_HOST = '192.168.1.216';
  var SERVER_PORT = 9999;

  function postJSON(path, payload) {
    try {
      var body = JSON.stringify(payload);
      var req = http.request({
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      });
      req.on('error', function () { /* swallow — best-effort */ });
      req.write(body);
      req.end();
    } catch (_) {}
  }

  // Boot event — prove the service launched and can reach the network.
  postJSON('/service-boot', {
    src: 'service',
    v: '0.0.4',
    ts: Date.now(),
    tizen: typeof tizen !== 'undefined',
  });

  // Heartbeat every 5s.
  setInterval(function () {
    postJSON('/service-heartbeat', {
      src: 'service',
      ts: Date.now(),
    });
  }, 5000);
})();
