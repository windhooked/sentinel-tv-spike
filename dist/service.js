// SENTINEL-TV — Phase 0 spike service v0.0.7 (expanded probe)
//
// Pure discovery — no launchAppControl, no behavior change.
// Maps out everything we'd want to know about our sandbox's capabilities,
// in one reinstall.
//
// Posts (in order):
//   /service-boot          basic startup info
//   /service-deps-probe    which modules require() can resolve
//   /service-tcp-probe     can we connect to 127.0.0.1:26101 (sdbd loopback)?
//   /service-fs-probe      what directories are readable?
//   /service-tizen-probe   tizen.* and webapis.* surface
//   /service-apps-probe    installed apps list (esp. native YouTube TV)
//   /service-process-probe pid, cwd, __dirname, partial env
//   /service-heartbeat     ongoing 5s heartbeats

(function () {
  'use strict';

  var http = require('http');
  var SERVER_HOST = '192.168.1.216';
  var SERVER_PORT = 9999;
  var VERSION = '0.0.7';

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

  // ── 1. Boot ───────────────────────────────────────────────────────────
  postJSON('/service-boot', {
    src: 'service', v: VERSION, ts: Date.now(),
    tizen: typeof tizen !== 'undefined',
    webapis: typeof webapis !== 'undefined',
    node: typeof process !== 'undefined' ? process.version : 'unknown',
  });

  // ── 2. Heartbeat ──────────────────────────────────────────────────────
  setInterval(function () {
    postJSON('/service-heartbeat', { src: 'service', v: VERSION, ts: Date.now() });
  }, 5000);

  // ── 3. Deps probe ─────────────────────────────────────────────────────
  function probe(name) {
    try {
      var mod = require(name);
      return {
        ok: true,
        type: typeof mod,
        keys: mod && typeof mod === 'object' ? Object.keys(mod).slice(0, 20) : null,
      };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e), code: e && e.code };
    }
  }

  postJSON('/service-deps-probe', {
    v: VERSION,
    results: {
      'http': probe('http'),
      'net': probe('net'),
      'fs': probe('fs'),
      'crypto': probe('crypto'),
      'tls': probe('tls'),
      'events': probe('events'),
      'util': probe('util'),
      'path': probe('path'),
      'buffer': probe('buffer'),
      'os': probe('os'),
      'child_process': probe('child_process'),
      // Third-party from TizenBrew's package.json
      'adbhost': probe('adbhost'),
      'chrome-remote-interface': probe('chrome-remote-interface'),
      'ws': probe('ws'),
      'ws-new': probe('ws-new'),
      'ws-old': probe('ws-old'),
      'express': probe('express'),
      'node-fetch': probe('node-fetch'),
    },
    ts: Date.now(),
  });

  // ── 4. TCP probe — can we reach the TV's own sdbd? ─────────────────────
  // If this connects, we can speak ADB wire protocol ourselves without
  // adbhost, using only the built-in `net` module.
  (function () {
    try {
      var net = require('net');
      var sock = net.connect({ host: '127.0.0.1', port: 26101 });
      var resolved = false;
      var timer = setTimeout(function () {
        if (resolved) return; resolved = true;
        try { sock.destroy(); } catch (_) {}
        postJSON('/service-tcp-probe', {
          v: VERSION, target: '127.0.0.1:26101',
          state: 'timeout', ts: Date.now(),
        });
      }, 3000);

      sock.on('connect', function () {
        if (resolved) return; resolved = true;
        clearTimeout(timer);
        postJSON('/service-tcp-probe', {
          v: VERSION, target: '127.0.0.1:26101',
          state: 'connected',
          localAddress: sock.localAddress,
          localPort: sock.localPort,
          ts: Date.now(),
        });
        try { sock.end(); } catch (_) {}
      });

      sock.on('error', function (e) {
        if (resolved) return; resolved = true;
        clearTimeout(timer);
        postJSON('/service-tcp-probe', {
          v: VERSION, target: '127.0.0.1:26101',
          state: 'error',
          err: String((e && e.message) || e),
          code: e && e.code,
          ts: Date.now(),
        });
      });
    } catch (e) {
      postJSON('/service-tcp-probe', {
        v: VERSION, state: 'threw', err: String((e && e.message) || e),
        ts: Date.now(),
      });
    }
  })();

  // ── 5. Filesystem probe ────────────────────────────────────────────────
  (function () {
    try {
      var fs = require('fs');
      var paths = [
        '/',
        '/opt/usr/apps',
        '/opt/usr/home',
        '/home',
        '/home/owner',
        '/home/owner/share',
        '/home/owner/share/tmp',
        '/data',
        '/tmp',
      ];
      var fsResults = {};
      paths.forEach(function (p) {
        try {
          var entries = fs.readdirSync(p);
          fsResults[p] = { ok: true, count: entries.length, sample: entries.slice(0, 12) };
        } catch (e) {
          fsResults[p] = { ok: false, err: String((e && e.message) || e), code: e && e.code };
        }
      });
      // Also try to read TizenBrew's config (we saw this path in configuration.js)
      try {
        var cfg = fs.readFileSync('/home/owner/share/tizenbrewConfig.json', 'utf8');
        fsResults['tizenbrewConfig.json'] = { ok: true, size: cfg.length, preview: cfg.slice(0, 200) };
      } catch (e) {
        fsResults['tizenbrewConfig.json'] = { ok: false, err: String((e && e.message) || e) };
      }
      postJSON('/service-fs-probe', { v: VERSION, results: fsResults, ts: Date.now() });
    } catch (e) {
      postJSON('/service-fs-probe', { v: VERSION, error: String(e && e.message || e), ts: Date.now() });
    }
  })();

  // ── 6. tizen.* / webapis.* surface ─────────────────────────────────────
  (function () {
    function shallow(o, depth) {
      if (!o || typeof o !== 'object') return typeof o;
      var keys = Object.keys(o);
      if (!depth || keys.length === 0) return keys;
      var out = {};
      keys.slice(0, 25).forEach(function (k) {
        try {
          out[k] = (o[k] && typeof o[k] === 'object') ? Object.keys(o[k]).slice(0, 25) : typeof o[k];
        } catch (e) {
          out[k] = 'inaccessible:' + (e && e.message);
        }
      });
      return out;
    }
    var t = {};
    try { t.tizen = typeof tizen !== 'undefined' ? shallow(tizen, 1) : 'undefined'; } catch (e) { t.tizen = 'error:' + e.message; }
    try { t.webapis = typeof webapis !== 'undefined' ? shallow(webapis, 1) : 'undefined'; } catch (e) { t.webapis = 'error:' + e.message; }
    // Specifically interesting subnamespaces
    try { t['tizen.application'] = typeof tizen !== 'undefined' && tizen.application ? Object.keys(tizen.application).slice(0, 25) : null; } catch (e) { t['tizen.application'] = 'err:' + e.message; }
    try { t['tizen.tv'] = typeof tizen !== 'undefined' && tizen.tv ? Object.keys(tizen.tv).slice(0, 25) : null; } catch (e) { t['tizen.tv'] = 'err:' + e.message; }
    try { t['tizen.systeminfo'] = typeof tizen !== 'undefined' && tizen.systeminfo ? Object.keys(tizen.systeminfo).slice(0, 25) : null; } catch (e) { t['tizen.systeminfo'] = 'err:' + e.message; }
    postJSON('/service-tizen-probe', { v: VERSION, ...t, ts: Date.now() });
  })();

  // ── 7. Installed apps list ─────────────────────────────────────────────
  (function () {
    try {
      if (typeof tizen === 'undefined' || !tizen.application) {
        postJSON('/service-apps-probe', { v: VERSION, error: 'no tizen.application', ts: Date.now() });
        return;
      }
      tizen.application.getAppsInfo(
        function (apps) {
          var summary = apps.map(function (a) {
            return { id: a.id, name: a.name, packageId: a.packageId, version: a.version };
          });
          // Look for YouTube specifically
          var youtube = summary.filter(function (a) {
            return (a.id || '').toLowerCase().indexOf('youtube') >= 0
                || (a.name || '').toLowerCase().indexOf('youtube') >= 0
                || (a.packageId || '').toLowerCase().indexOf('youtube') >= 0;
          });
          postJSON('/service-apps-probe', {
            v: VERSION,
            count: summary.length,
            youtube_matches: youtube,
            all: summary,
            ts: Date.now(),
          });
        },
        function (err) {
          postJSON('/service-apps-probe', {
            v: VERSION, error: 'getAppsInfo callback err: ' + String(err && err.message || err),
            ts: Date.now(),
          });
        }
      );
    } catch (e) {
      postJSON('/service-apps-probe', { v: VERSION, error: 'threw: ' + String(e && e.message || e), ts: Date.now() });
    }
  })();

  // ── 8. Process info ────────────────────────────────────────────────────
  (function () {
    try {
      var info = {
        v: VERSION,
        pid: process.pid,
        cwd: process.cwd(),
        execPath: process.execPath,
        argv: process.argv,
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        __dirname: typeof __dirname !== 'undefined' ? __dirname : 'undefined',
        __filename: typeof __filename !== 'undefined' ? __filename : 'undefined',
        // Only safe env vars — skip the rest for privacy
        env_keys: process.env ? Object.keys(process.env).slice(0, 30) : null,
        ts: Date.now(),
      };
      postJSON('/service-process-probe', info);
    } catch (e) {
      postJSON('/service-process-probe', { v: VERSION, error: String(e && e.message || e), ts: Date.now() });
    }
  })();
})();
