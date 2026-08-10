/*
 * Video Reverse – worker.js
 * ------------------------------------------------------------------
 * FFmpeg.wasm wird VOLLSTÄNDIG innerhalb dieses Workers ausgeführt.
 *
 * Warum funktioniert das, ohne den bekannten Cross-Origin-Fehler
 *   "Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/...'
 *    cannot be accessed from origin ..." ?
 *
 * 1. index.html erzeugt diesen Worker über einen RELATIVEN Pfad:
 *       new Worker("./worker.js")
 *    Damit ist dieser Worker same-origin – es entsteht kein
 *    Cross-Origin-Worker.
 *
 * 2. Wir nutzen NICHT den High-Level-Wrapper @ffmpeg/ffmpeg (dessen
 *    UMD-Build intern selbst einen Worker aus einer CDN-Chunk-Datei
 *    erzeugt). Stattdessen laden wir direkt das single-threaded
 *    @ffmpeg/core über importScripts() in DIESEN Worker. Single-Thread
 *    braucht keinen weiteren Worker.
 *
 * 3. importScripts() mit einem Blob-URL lädt das Core-Skript same-origin.
 *    Der Core selbst lädt sein WASM über den "mainScriptUrlOrBlob"-Hack,
 *    in dem wasmURL/workerURL als Blob-URLs kodiert werden – ebenfalls
 *    same-origin. Es wird nirgends ein Worker aus einer CDN-URL erzeugt.
 *
 * Dadurch gibt es genau EINE Workerebene und keinerlei CORS-/Same-Origin-
 * Probleme.
 */

"use strict";

/* ------------------------------------------------------------------ */
/* Konfiguration – bei Bedarf einfach den CDN-Host austauschen.        */
/* ------------------------------------------------------------------ */
var CORE_VERSION = "0.12.6"; // single-threaded @ffmpeg/core
var CORE_BASE =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" +
  CORE_VERSION +
  "/dist/umd";

var ffmpeg = null; // Instanz des FFmpeg-Cores (wird gecacht)
var initPromise = null; // laufende Initialisierung
var lastLogs = []; // letzte FFmpeg-Logzeilen für Fehlerdiagnose

/* ------------------------------------------------------------------ */
/* Kleine Helfer                                                       */
/* ------------------------------------------------------------------ */

// Nachricht an den Main-Thread senden (optional mit Transferables).
function send(msg, transfer) {
  try {
    self.postMessage(msg, transfer || []);
  } catch (_) {
    self.postMessage(msg);
  }
}

// URL per fetch() laden und als Blob-URL zurückgeben (same-origin, CORS-sicher).
async function toBlobURL(url, mimeType) {
  var resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      "HTTP " +
        resp.status +
        " – " +
        resp.statusText +
        " beim Abruf von " +
        url
    );
  }
  var data = await resp.arrayBuffer();
  return URL.createObjectURL(new Blob([data], { type: mimeType }));
}

// Endung einer Datei sichern; nur bekannte Video-Endungen werden behalten.
function sanitizeExtension(name) {
  var m = /\.([a-zA-Z0-9]{1,6})$/.exec(name || "");
  var ext = m ? m[1].toLowerCase() : "";
  var known = [
    "mp4", "mov", "webm", "mkv", "m4v", "avi", "mpeg", "mpg",
    "ts", "mts", "m2ts", "3gp", "ogv", "wmv", "flv", "mp4v", "m4a",
  ];
  if (known.indexOf(ext) !== -1) {
    return "." + ext;
  }
  return ""; // kein/weniger bekanntes Format → FFmpeg probt den Inhalt
}

/* ------------------------------------------------------------------ */
/* FFmpeg initialisieren (lazy, wird nur einmal geladen und gecacht)   */
/* ------------------------------------------------------------------ */
function initFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (initPromise) return initPromise;

  initPromise = (async function () {
    send({ type: "progress", value: 2, text: "FFmpeg wird geladen… (Dateien werden heruntergeladen)" });

    var coreURL, wasmURL;
    try {
      coreURL = await toBlobURL(CORE_BASE + "/ffmpeg-core.js", "text/javascript");
      wasmURL = await toBlobURL(CORE_BASE + "/ffmpeg-core.wasm", "application/wasm");
    } catch (e) {
      initPromise = null;
      throw new Error(
        "FFmpeg konnte nicht von der CDN geladen werden: " +
          (e && e.message ? e.message : e) +
          " Bitte prüfen Sie die Internetverbindung und versuchen Sie es erneut."
      );
    }

    send({ type: "progress", value: 4, text: "FFmpeg wird initialisiert…" });

    // Core-Skript in DIESEN Worker laden (blob = same-origin).
    try {
      importScripts(coreURL);
    } catch (e) {
      initPromise = null;
      throw new Error(
        "Das FFmpeg-Core-Skript konnte nicht geladen werden: " +
          (e && e.message ? e.message : e)
      );
    }

    if (typeof self.createFFmpegCore !== "function") {
      initPromise = null;
      throw new Error(
        "Der geladene FFmpeg-Core ist unerwartet aufgebaut (createFFmpegCore fehlt)."
      );
    }

    // Der Core lädt sein WASM über den "mainScriptUrlOrBlob"-Hack,
    // in dem wasmURL/workerURL als Blob-URLs kodiert sind (same-origin).
    var workerURL = coreURL; // Single-Thread-Core nutzt workerURL nicht.
    ffmpeg = await self.createFFmpegCore({
      mainScriptUrlOrBlob:
        coreURL + "#" + btoa(JSON.stringify({ wasmURL: wasmURL, workerURL: workerURL })),
      // Zusätzliche, direkte Absicherung: Der Emscripten-Preamble ruft
      // Module.locateFile("ffmpeg-core.wasm") auf, um wasmBinaryFile zu
      // bestimmen. Wir liefern die Blob-URL direkt – damit ist das Laden
      // des WASM garantiert same-origin und unabhängig vom Fragment-Parsing.
      locateFile: function (path, prefix) {
        if (path === "ffmpeg-core.wasm") return wasmURL;
        return prefix ? prefix + path : path;
      },
    });

    ffmpeg.setLogger(function (_a) {
      var message = _a.message;
      lastLogs.push(message);
      if (lastLogs.length > 400) lastLogs.shift();
      send({ type: "log", message: message });
    });

    ffmpeg.setProgress(function (_a) {
      var progress = _a.progress; // 0..1 während der Verarbeitung
      var pct = 15 + progress * 73;
      send({
        type: "progress",
        value: pct,
        text: "Video + Ton werden rückwärts verarbeitet…",
      });
    });

    send({ type: "progress", value: 6, text: "FFmpeg ist bereit." });
    return ffmpeg;
  })();

  return initPromise;
}

/* ------------------------------------------------------------------ */
/* FFmpeg-Befehl                                                        */
/* ------------------------------------------------------------------ */
function buildCommand(inputName, withAudio) {
  var args = [
    "-hide_banner",
    "-y",
    "-i", inputName,
    "-map", "0:v:0", // Videospur
    "-map", "0:a:0?", // optionale Audiospur (führt nie zu einem Fehler)
    "-vf", "reverse", // Video rückwärts
    "-c:v", "libx264", // H.264 für breite Kompatibilität
    "-crf", "17", // niedrige Kompression → hohe Qualität
    // Schnelles Preset: deutlich kürzere Verarbeitungszeit. Die Qualität
    // bleibt (CRF-gesteuert) gleich, die Datei wird nur etwas größer –
    // bei kurzen Videos (≲ 20 s) unkritisch.
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p", // Browser-kompatible Pixelfarbe
    "-movflags", "+faststart", // sofortiges Streamen/Abspielen
  ];
  if (withAudio) {
    args.push(
      "-af", "areverse", // Audio rückwärts
      "-c:a", "aac",
      "-b:a", "192k"
    );
  }
  args.push("output.mp4");
  return args;
}

/* ------------------------------------------------------------------ */
/* Verarbeitung                                                         */
/* ------------------------------------------------------------------ */
async function processVideo(opts) {
  var file = opts.file; // Uint8Array
  var fileName = opts.fileName || "video.mp4";

  send({ type: "progress", value: 7, text: "Video wird eingelesen…" });

  var core = await initFFmpeg(); // initialisiert einmal, danach gecacht

  var ext = sanitizeExtension(fileName);
  var inputName = "input" + ext;
  var baseName = String(fileName).replace(/\.[^./]+$/, "") || "video";
  var outputName = baseName + "-rueckwaerts.mp4";

  send({ type: "progress", value: 10, text: "Video wird in den Speicher geschrieben…" });
  core.FS.writeFile(inputName, file);

  // Mit Audiospur versuchen.
  var args = buildCommand(inputName, true);
  send({ type: "progress", value: 12, text: "Video + Ton werden rückwärts verarbeitet…" });
  var ret = runExec(core, args);

  // Fallback: Falls es (z. B. wegen fehlender/ungeeigneter Audiospur)
  // fehlschlägt, einmal ohne Audiofilter erneut versuchen.
  if (ret !== 0) {
    lastLogs.push("[Video Reverse] Erster Versuch fehlgeschlagen – erneuter Versuch ohne Audiospur…");
    args = buildCommand(inputName, false);
    send({ type: "progress", value: 40, text: "Erneuter Versuch ohne Audiospur…" });
    ret = runExec(core, args);
  }

  if (ret !== 0) {
    throw new Error(
      "FFmpeg konnte das Video nicht verarbeiten (Exit-Code " + ret + ")."
    );
  }

  send({ type: "progress", value: 90, text: "Ergebnis wird vorbereitet…" });

  var out;
  try {
    out = core.FS.readFile("output.mp4");
  } catch (e) {
    throw new Error(
      "Das Ergebnis konnte nicht gelesen werden: " + (e && e.message ? e.message : e)
    );
  }

  // Aufräumen im internen Dateisystem.
  try { core.FS.unlink(inputName); } catch (_) {}
  try { core.FS.unlink("output.mp4"); } catch (_) {}

  var buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  send(
    { type: "done", fileName: outputName, mimeType: "video/mp4", data: buffer },
    [buffer] // ArrayBuffer als Transferable → keine Kopie
  );
}

// Führt FFmpeg synchron aus und liefert den Exit-Code.
function runExec(core, args) {
  try {
    core.setTimeout(-1);
    core.exec.apply(core, args);
    return core.ret;
  } catch (e) {
    lastLogs.push("EXEC-ERROR: " + (e && e.message ? e.message : e));
    return -1;
  }
}

/* ------------------------------------------------------------------ */
/* Fehlermeldung für normale Benutzer                                   */
/* ------------------------------------------------------------------ */
function friendlyMessage(err) {
  var raw = String((err && err.message) || err || "");
  var all = raw + "\n" + lastLogs.join("\n");
  if (/Out of memory|Cannot allocate|ENOMEM|allocation failed|Memory access|RangeError/i.test(all)) {
    return "Der Speicher des Browsers hat für dieses Video nicht ausgereicht. Für rückwärts wird das komplette Video im Arbeitsspeicher gehalten – bitte versuchen Sie ein kürzeres oder kleineres Video.";
  }
  if (/failed to load wasm|NetworkError|Failed to fetch|HTTP 4|HTTP 5|Couldn't connect|load error/i.test(all)) {
    return "FFmpeg konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.";
  }
  if (/Stream map '0:v:0'|does not match any streams|match.*no stream/i.test(all)) {
    return "Die Datei enthält offenbar keine lesbare Videospur.";
  }
  if (/Invalid data found when processing input|error while decoding|moov atom not found|Invalid argument|not a valid|packet size/i.test(all)) {
    return "Die Videodatei konnte nicht gelesen werden. Sie ist möglicherweise beschädigt, unvollständig oder das Format wird nicht unterstützt.";
  }
  if (/Unknown encoder|Encoder not found|not supported|Invalid codec/i.test(all)) {
    return "Die Datei verwendet einen Codec, den die im Browser verfügbare FFmpeg-Version nicht unterstützt.";
  }
  if (/no native wasm|WebAssembly.*not|WASM/i.test(all)) {
    return "Ihr Browser unterstützt WebAssembly nicht, das für die Verarbeitung benötigt wird.";
  }
  return "Bei der Verarbeitung ist ein unerwarteter Fehler aufgetreten.";
}

/* ------------------------------------------------------------------ */
/* Nachrichten empfangen                                                */
/* ------------------------------------------------------------------ */
self.onmessage = async function (e) {
  var type = e.data && e.data.type;
  if (type === "process") {
    try {
      var file = e.data.file;
      if (file instanceof Uint8Array) {
        file = new Uint8Array(file);
      } else if (file instanceof ArrayBuffer) {
        file = new Uint8Array(file);
      } else {
        throw new Error("Ungültige Dateidaten vom Main-Thread empfangen.");
      }
      await processVideo({ file: file, fileName: e.data.fileName });
    } catch (err) {
      var details =
        String(err && err.message ? err.message : err) +
        "\n\n--- FFmpeg-Log (letzte Ausgaben) ---\n" +
        lastLogs.slice(-80).join("\n");
      send({ type: "error", message: friendlyMessage(err), details: details });
    }
  } else {
    send({
      type: "error",
      message: "Unbekannte Nachricht an den Worker.",
      details: "type = " + String(type),
    });
  }
};
