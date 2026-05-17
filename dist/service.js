// SENTINEL-TV — Phase 0 spike service v0.0.6
//
// v0.0.6 change: mirror TizenTube's launchAppControl call EXACTLY.
//   - 2 args (appControl + targetAppId), no success/error callbacks.
//   - Operation `http://tizen.org/appcontrol/operation/view` (same as TizenTube).
//   - ApplicationControlData("module", [JSON{moduleName,moduleType,args}]).
//
// Hypothesis: v0.0.5 silently failed because we passed 4 args (callbacks).
// Tizen may have rejected or ignored the call.

(function () {
  'use strict';

  var http = require('http');
  var SERVER_HOST = '192.168.1.216';
  var SERVER_PORT = 9999;
  var VERSION = '0.0.6';

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

  postJSON('/service-boot', {
    src: 'service',
    v: VERSION,
    ts: Date.now(),
    tizen: typeof tizen !== 'undefined',
  });

  setInterval(function () {
    postJSON('/service-heartbeat', { src: 'service', v: VERSION, ts: Date.now() });
  }, 5000);

  // ── TizenTube-exact launchAppControl call ────────────────────────────
  // After a 3s settle, fire the exact call TizenTube uses.
  setTimeout(function () {
    var step = 'pre-getAppInfo';
    try {
      var appInfo = tizen.application.getAppInfo();
      var tbPackageId = appInfo.packageId;
      step = 'pre-new-ApplicationControlData';

      var moduleArg = JSON.stringify({
        moduleName: 'windhooked/sentinel-tv-spike',
        moduleType: 'gh',
        args: {},
      });

      postJSON('/service-launch-attempt', {
        v: VERSION,
        tbPackageId: tbPackageId,
        ownAppId: appInfo.id,
        target: tbPackageId + '.TizenBrewStandalone',
        moduleArg: moduleArg,
        ts: Date.now(),
      });

      step = 'pre-launchAppControl';
      // EXACTLY TizenTube's call shape — 2 args, no callbacks.
      tizen.application.launchAppControl(
        new tizen.ApplicationControl(
          'http://tizen.org/appcontrol/operation/view',
          null, null, null,
          [new tizen.ApplicationControlData('module', [moduleArg])]
        ),
        tbPackageId + '.TizenBrewStandalone'
      );

      // If we got here, the call returned synchronously without throwing.
      postJSON('/service-launch-issued', { v: VERSION, ts: Date.now() });
    } catch (e) {
      postJSON('/service-launch-throw', {
        v: VERSION,
        step: step,
        msg: String((e && e.message) || e),
        name: String(e && e.name),
        type: String(e && e.type),
        stack: String((e && e.stack) || ''),
        ts: Date.now(),
      });
    }
  }, 3000);

  // ── Post-launch heartbeat with version tag ───────────────────────────
  // Re-fire a heartbeat 10s after launch attempt so we can correlate.
  setTimeout(function () {
    postJSON('/service-post-launch', {
      v: VERSION,
      ts: Date.now(),
      uptime_seconds: 10,
    });
  }, 13000);
})();
