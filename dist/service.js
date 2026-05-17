// SENTINEL-TV — Phase 0 spike service v0.0.9
//
// Hand-rolled ADB wire protocol probe.
// Uses only Node 4.4.3 built-ins (net, http) — no third-party deps.
//
// Goal: complete an ADB CNXN handshake against the TV's own sdbd at
// 127.0.0.1:26101, then open a shell stream and send
//   `shell:0 debug com.samsung.tv.cobalt-yt`
// and read the response (which should include the CDP debug port).
//
// Every packet sent/received is mirrored to /adb-* POSTs so we can
// see the wire trace from the dev box without sdb shell.
//
// v0.0.9 stops after reading shell output. v0.0.10 will use the parsed
// debug port to open WebSocket + CDP and inject our userScript.

(function () {
  'use strict';

  var http = require('http');
  var net = require('net');
  var SERVER_HOST = '192.168.1.216';
  var SERVER_PORT = 9999;
  var VERSION = '0.0.9';

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
      req.on('error', function () {});
      req.write(body);
      req.end();
    } catch (_) {}
  }

  postJSON('/service-boot', {
    src: 'service', v: VERSION, ts: Date.now(),
    tizen: typeof tizen !== 'undefined',
    node: typeof process !== 'undefined' ? process.version : 'unknown',
  });

  setInterval(function () {
    postJSON('/service-heartbeat', { src: 'service', v: VERSION, ts: Date.now() });
  }, 5000);

  // ── ADB wire protocol ────────────────────────────────────────────────
  // Constants (4-byte ASCII little-endian):
  var CMD_CNXN = 0x4e584e43; // "CNXN"
  var CMD_OPEN = 0x4e45504f; // "OPEN"
  var CMD_OKAY = 0x59414b4f; // "OKAY"
  var CMD_WRTE = 0x45545257; // "WRTE"
  var CMD_CLSE = 0x45534c43; // "CLSE"

  var CMD_NAMES = {};
  CMD_NAMES[CMD_CNXN] = 'CNXN';
  CMD_NAMES[CMD_OPEN] = 'OPEN';
  CMD_NAMES[CMD_OKAY] = 'OKAY';
  CMD_NAMES[CMD_WRTE] = 'WRTE';
  CMD_NAMES[CMD_CLSE] = 'CLSE';

  // Buffer helpers — Node 4.4.3 doesn't have Buffer.alloc / Buffer.from.
  function buf(size) { return new Buffer(size); }
  function strBuf(s) { return new Buffer(s, 'utf8'); }

  function makePacket(cmd, arg0, arg1, payload) {
    var data = payload || buf(0);
    var header = buf(24);
    header.writeUInt32LE(cmd, 0);
    header.writeUInt32LE(arg0 >>> 0, 4);
    header.writeUInt32LE(arg1 >>> 0, 8);
    header.writeUInt32LE(data.length, 12);
    header.writeUInt32LE(0, 16); // data_check (crc32) — try 0; modern sdbd accepts
    header.writeUInt32LE((cmd ^ 0xFFFFFFFF) >>> 0, 20); // magic
    return Buffer.concat([header, data]);
  }

  function parseHeader(b) {
    return {
      cmd: b.readUInt32LE(0),
      arg0: b.readUInt32LE(4),
      arg1: b.readUInt32LE(8),
      data_length: b.readUInt32LE(12),
      data_check: b.readUInt32LE(16),
      magic: b.readUInt32LE(20),
    };
  }

  // Single shell stream local-id we use for the debug request.
  var OUR_LOCAL_ID = 0x42;

  // Connect after a short delay so service-boot has time to land.
  setTimeout(function () {
    postJSON('/adb-attempt', { v: VERSION, target: '127.0.0.1:26101', ts: Date.now() });

    var sock;
    try {
      sock = net.connect({ host: '127.0.0.1', port: 26101 });
    } catch (e) {
      postJSON('/adb-throw', { phase: 'net.connect', err: String((e && e.message) || e), ts: Date.now() });
      return;
    }

    var pending = buf(0);
    var phase = 'pre-connect';
    var pktCount = 0;
    var shellOutput = '';

    sock.on('connect', function () {
      phase = 'sent-CNXN';
      // CNXN: version=0x01000001 (post-Android 9), max_payload=256KB, banner.
      var banner = strBuf('host::features=shell_v2\0');
      var pkt = makePacket(CMD_CNXN, 0x01000001, 0x00040000, banner);
      sock.write(pkt);
      postJSON('/adb-tx', {
        phase: phase,
        cmd: 'CNXN',
        payload_text: banner.toString('utf8'),
        ts: Date.now(),
      });
    });

    sock.on('data', function (chunk) {
      pending = Buffer.concat([pending, chunk]);
      // Parse complete packets
      while (pending.length >= 24) {
        var h = parseHeader(pending);
        if (pending.length < 24 + h.data_length) break; // partial — wait for more
        var data = pending.slice(24, 24 + h.data_length);
        pending = pending.slice(24 + h.data_length);
        pktCount++;

        var cmdName = CMD_NAMES[h.cmd] || ('0x' + h.cmd.toString(16));
        postJSON('/adb-rx', {
          n: pktCount,
          cmd: cmdName,
          arg0: '0x' + (h.arg0 >>> 0).toString(16),
          arg1: '0x' + (h.arg1 >>> 0).toString(16),
          data_length: h.data_length,
          payload_text: data.toString('utf8').slice(0, 400),
          payload_hex: data.toString('hex').slice(0, 200),
          ts: Date.now(),
        });

        if (h.cmd === CMD_CNXN) {
          // Handshake done. Open a shell stream.
          phase = 'sent-OPEN-shell';
          var shellCmd = strBuf('shell:0 debug com.samsung.tv.cobalt-yt\0');
          var openPkt = makePacket(CMD_OPEN, OUR_LOCAL_ID, 0, shellCmd);
          sock.write(openPkt);
          postJSON('/adb-tx', {
            phase: phase,
            cmd: 'OPEN',
            local_id: OUR_LOCAL_ID,
            payload_text: shellCmd.toString('utf8'),
            ts: Date.now(),
          });
        } else if (h.cmd === CMD_OKAY && phase === 'sent-OPEN-shell') {
          // shell stream accepted. arg0 = their_local_id, arg1 = our_local_id
          phase = 'shell-open';
          postJSON('/adb-shell-opened', {
            their_id: '0x' + (h.arg0 >>> 0).toString(16),
            our_id: '0x' + (h.arg1 >>> 0).toString(16),
            ts: Date.now(),
          });
        } else if (h.cmd === CMD_WRTE && phase === 'shell-open') {
          // Shell output. Accumulate, and ACK with OKAY.
          shellOutput += data.toString('utf8');
          var ackPkt = makePacket(CMD_OKAY, OUR_LOCAL_ID, h.arg0, null);
          sock.write(ackPkt);
        } else if (h.cmd === CMD_CLSE) {
          phase = 'closed';
          postJSON('/adb-shell-closed', {
            shellOutput: shellOutput.slice(0, 2000),
            ts: Date.now(),
          });
          try { sock.end(); } catch (_) {}
        }
      }
    });

    sock.on('error', function (e) {
      postJSON('/adb-error', {
        phase: phase,
        err: String((e && e.message) || e),
        code: e && e.code,
        ts: Date.now(),
      });
    });

    sock.on('close', function (hadError) {
      postJSON('/adb-socket-close', {
        phase: phase,
        hadError: !!hadError,
        pktCount: pktCount,
        shellOutput_len: shellOutput.length,
        shellOutput_preview: shellOutput.slice(0, 1000),
        ts: Date.now(),
      });
    });

    // Safety: if nothing happens within 10s, log status.
    setTimeout(function () {
      postJSON('/adb-timeout-check', {
        phase: phase,
        pktCount: pktCount,
        ts: Date.now(),
      });
    }, 10000);
  }, 2000);
})();
