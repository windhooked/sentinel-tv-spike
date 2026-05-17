// SENTINEL-TV — Phase 0 spike service v0.0.5
//
// Builds on v0.0.4 by mirroring TizenTube's launchAppControl pattern.
// After a 3s settle, the service relaunches TizenBrewStandalone with
// our module as the appcontrol payload — this triggers TizenBrew's
// WebView injection path, which the tile-click path does NOT.
//
// Diagnostic POSTs at each step so we can see exactly where the path
// succeeds or breaks.

(function () {
  'use strict';

  var http = require('http');
  var SERVER_HOST = '192.168.1.216';
  var SERVER_PORT = 9999;
  var VERSION = '0.0.5';

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
      req.on('error', function () { /* swallow */ });
      req.write(body);
      req.end();
    } catch (_) {}
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  postJSON('/service-boot', {
    src: 'service',
    v: VERSION,
    ts: Date.now(),
    tizen: typeof tizen !== 'undefined',
  });

  // ── Heartbeat ────────────────────────────────────────────────────────
  setInterval(function () {
    postJSON('/service-heartbeat', { src: 'service', v: VERSION, ts: Date.now() });
  }, 5000);

  // ── TizenTube-style launchAppControl trick ───────────────────────────
  // Wait 3s for the tile-click flow to settle, then relaunch
  // TizenBrewStandalone with appcontrol data pointing at our module.
  // TizenBrew should react by injecting our mainFile (userScript.js)
  // into the WebView that loads the module's websiteURL.
  setTimeout(function () {
    try {
      // tizen.application.getAppInfo() in the service context returns
      // info for the TizenBrew main app (us, since we run inside it).
      var appInfo = tizen.application.getAppInfo();
      var tbPackageId = appInfo.packageId;
      var ownAppId = appInfo.id;

      postJSON('/service-launch-attempt', {
        tbPackageId: tbPackageId,
        ownAppId: ownAppId,
        target: tbPackageId + '.TizenBrewStandalone',
        ts: Date.now(),
      });

      var moduleData = JSON.stringify({
        moduleName: 'windhooked/sentinel-tv-spike',
        moduleType: 'gh',
        args: {},
      });

      var appControl = new tizen.ApplicationControl(
        'http://tizen.org/appcontrol/operation/view',
        null, null, null,
        [new tizen.ApplicationControlData('module', [moduleData])]
      );

      tizen.application.launchAppControl(
        appControl,
        tbPackageId + '.TizenBrewStandalone',
        function onSuccess() {
          postJSON('/service-launch-ok', { ts: Date.now() });
        },
        function onError(e) {
          postJSON('/service-launch-err', {
            msg: String((e && e.message) || e),
            type: String(e && e.type),
            ts: Date.now(),
          });
        }
      );
    } catch (e) {
      postJSON('/service-launch-throw', {
        msg: String((e && e.message) || e),
        stack: String(e && e.stack || ''),
        ts: Date.now(),
      });
    }
  }, 3000);
})();
