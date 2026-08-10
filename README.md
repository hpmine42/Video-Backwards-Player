# ↶ Video Reverse

Spiele **Video und Ton rückwärts** ab – bequem im Browser. Lade ein beliebiges lokales Video hoch, und die App erzeugt eine rückwärts abgespielte **MP4-Datei**, die du direkt ansehen und herunterladen kannst.

**Das Besondere:** Die komplette Verarbeitung passiert **lokal in deinem Browser** (FFmpeg.wasm in einem Web Worker). Dein Video wird **niemals** auf einen Server hochgeladen.

---

## ✨ Features

- 🎬 **Vollständig clientseitig** – kein Upload, kein Server, kein Backend.
- ⏪ **Video rückwärts** (`reverse`) **und Audio rückwärts** (`areverse`).
- 🔇 Videos **ohne Audiospur** werden automatisch erkannt und trotzdem verarbeitet.
- 🎥 Unterstützt gängige Formate: **MP4, WebM, MOV, MKV, AVI, M4V, MPEG, 3GP** u. a. – alles, was FFmpeg.wasm lesen kann.
- 🖼️ **Hohe Qualität & schnell:** Auflösung, Seitenverhältnis und Framerate bleiben erhalten; Re-Encoding mit `libx264` / `crf 17` (sehr geringe Kompression) und dem **schnellen Preset `veryfast`**, `aac` 192 kbit/s, `+faststart`.
- ▶️ Ergebnis direkt im Browser **ansehen** und als **MP4 herunterladen**.
- ⏪ **Live-Rückwärts-Vorschau:** das Video direkt im Browser sofort rückwärts ansehen – **ohne Wartezeit** und ohne Konvertierung (Bild; Ton gibt es rückwärts in der konvertierten Datei).
- 🖱️ **Drag & Drop** oder Dateiauswahl.
- 📱 Responsive, modernes **Apple-inspiriertes** Design (Glassmorphism, dunkles Theme).
- 🔒 **Datenschutzfreundlich:** keine Analyse, keine Cookies, keine persönlichen Daten, Dateien werden nach Nutzung freigegeben.

---

## 🧱 Technik

| | |
|---|---|
| Sprache | HTML, CSS, Vanilla JavaScript |
| Framework | keins (kein React/Vue/Next, kein Build-System) |
| Engine | [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) (`@ffmpeg/core`) |
| Worker | eigene, same-origin `worker.js` |
| Deployment | statische Hosting (Netlify, GitHub Pages, überall) |

### Dateistruktur

```
.
├── index.html      # komplette Benutzeroberfläche (HTML + CSS + JS)
├── worker.js       # FFmpeg.wasm-Verarbeitung (läuft im Worker)
├── netlify.toml    # optionale Netlify-Konfiguration
├── README.md
└── .gitignore
```

---

## 🚀 Installation & lokale Ausführung

Es gibt **keine Abhängigkeiten** und **kein npm** – du brauchst nur einen einfachen statischen Webserver (Worker und `fetch` funktionieren nicht zuverlässig über `file://`).

**Option 1 – Python:**
```bash
cd Video-Backwards-Player
python3 -m http.server 8080
# öffne http://localhost:8080
```

**Option 2 – Node:**
```bash
npx serve .
# öffne die angezeigte URL
```

**Option 3 – VS Code:** Erweiterung „Live Server" installieren und `index.html` starten.

> Hinweis: Öffne die Seite **nicht** per Doppelklick (`file://`). Einige Browser blockieren dann Web Worker.

---

## ☁️ Deployment auf Netlify

1. Repository nach GitHub pushen.
2. Auf [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
3. Dein Repository auswählen.
4. **Build settings:** keins nötig. Falls gewünscht, ist im `netlify.toml` bereits `publish = "."` gesetzt.
5. **Deploy** klicken.

Danach ist die App unter einer URL wie `https://dein-projekt.netlify.app` erreichbar. **Es wird keine Serverfunktion, kein Formular-Processing und kein Backend benötigt.** Das Repository kann auch direkt (ohne Umweg) mit Netlify verbunden werden.

---

## 🐙 Deployment auf GitHub Pages

1. Repository nach GitHub pushen (z. B. `Video-Backwards-Player`).
2. GitHub → **Settings → Pages**.
3. Bei **Source** `Deploy from a branch` wählen, Branch `main`, Ordner `/ (root)`.
4. Speichern. Nach kurzer Zeit ist die Seite verfügbar, z. B.
   `https://<benutzer>.github.io/Video-Backwards-Player/`.

Alle Pfade in diesem Projekt sind **relativ** (`./worker.js`), sodass auch Unterpfade wie `/<repo>/` problemlos funktionieren.

---

## ⚙️ Funktionsweise

1. `index.html` erzeugt einen Worker über `new Worker("./worker.js")` – einen **relativen**, same-origin Pfad.
2. `worker.js` lädt das FFmpeg-Core-Paket (`@ffmpeg/core`, single-threaded) per `importScripts` und das WASM über Blob-URLs.
3. Dein Video wird als `ArrayBuffer` **per Transferable** (ohne Kopie) an den Worker übergeben und in das interne Dateisystem von FFmpeg geschrieben.
4. FFmpeg führt aus (sinngemäß):
   ```
   -i input
   -map 0:v:0
   -map 0:a:0?
   -vf reverse
   -af areverse
   -c:v libx264 -crf 17 -preset veryfast -pix_fmt yuv420p
   -c:a aac -b:a 192k
   -movflags +faststart
   output.mp4
   ```
   `-map 0:a:0?` macht die Audiospur **optional** – Videos ohne Ton schlagen nicht fehl.
5. Das Ergebnis wird als `ArrayBuffer` zurückgesendet, als MP4-Blob im Browser angezeigt und kann heruntergeladen werden.

### Warum funktioniert der Worker „same-origin"?

Der bekannte Fehler
`Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/.../814.ffmpeg.js' cannot be accessed from origin ...`
entsteht, wenn ein Skript (z. B. der High-Level-Wrapper `@ffmpeg/ffmpeg`) direkt **aus einer CDN-URL einen Web Worker erzeugt**. Das ist der Web-Same-Origin-Policy untersagt.

Dieses Projekt umgeht das **konstruktiv**:

- Der Worker wird aus **unserer eigenen, same-origin `worker.js`** erzeugt (`new Worker("./worker.js")`). Das ist derselbe Ursprung wie die Seite – kein Cross-Origin-Worker.
- Wir verwenden **nicht** den Wrapper `@ffmpeg/ffmpeg`, dessen UMD-Build intern selbst einen Worker aus einer CDN-Chunk-Datei starten würde.
- Stattdessen laden wir **direkt** das single-threaded `@ffmpeg/core` **innerhalb unseres Workers** per `importScripts`. Single-Thread-Core erzeugt **keinen weiteren Worker** – es gibt also genau **eine** Workerebene.
- Core-Skript und WASM werden per `fetch()` geholt und in **Blob-URLs** (same-origin) umgewandelt. Das WASM wird über den offiziellen `mainScriptUrlOrBlob`-Mechanismus von ffmpeg.wasm geladen.

Damit wird nirgendwo ein Worker aus einer fremden Origin gestartet.

---

## ⏪ Live-Rückwärts-Vorschau (ohne FFmpeg)

Neben der Konvertierung gibt es einen **Sofort-Vorschaumodus**: Mit „⏪ Live rückwärts ansehen" wird das ausgewählte Video **direkt im Browser rückwärts abgespielt** – ohne Wartezeit und ohne FFmpeg.

So funktioniert es technisch:

- Das Video-Element läuft **vorwärts**, während die Seite es permanent um genau eine **Frame-Dauer zurückspult** (`currentTime`-Seeking). Das ergibt flüssiges Rückwärts-Abspielen.
- Die Framerate wird automatisch erkannt: Beim normalen Abspielen misst `requestVideoFrameCallback` die echte Frame-Dauer; sonst gilt 30 fps als Standard.
- Das Tempo wird **in Echtzeit geregelt**: Nach jedem Seek wird die tatsächliche Seek-Dauer gemessen und die Sprungweite daraus berechnet – die Rückwärtsgeschwindigkeit bleibt dadurch **immer ≈ 1× Echtzeit**, auch bei langsamen Seeks (dann werden entsprechend größere Sprünge gemacht).
- Erreicht die Wiedergabe den Anfang, **loopt** sie zurück ans Videoende (Rückwärts-Loop).
- **Ton** ist in der Live-Vorschau stummgeschaltet, weil sich Audio nicht per Seeking umkehren lässt. Rückwärts abgespielten Ton liefert die konvertierte Datei („↶ Video rückwärts erstellen").
- Die Vorschau endet automatisch beim Kartenwechsel, beim Start der Konvertierung oder beim Verlassen der Seite.

---

## 🔒 Datenschutz & Sicherheit

- ✅ **Kein Upload-Server** – die Datei bleibt im Browser.
- ✅ **Keine Analyse** / Tracking.
- ✅ **Keine Cookies** erforderlich.
- ✅ **Keine persönlichen Daten** werden gespeichert.
- ✅ Dateien werden nur **temporär** verarbeitet.
- ✅ **Object-URLs** (`URL.createObjectURL`) werden nach Nutzung freigegeben.
- ✅ Der **Worker wird beim Verlassen der Seite beendet** (`worker.terminate()`).

---

## ⚠️ Bekannte Browser-Limits

- **WebAssembly & Web Worker:** In den aktuellen Chrome, Edge, Firefox und Safari unterstützt. Sehr alte Browser ohne WebAssembly funktionieren nicht.
- **Speicher:** Für das Rückwärtsabspielen hält FFmpeg das komplette Video (und Audio) im Arbeitsspeicher. Bei sehr langen/hochauflösenden Videos kann der Browser-Speicher erschöpft sein. Typische Verhältnisse: ein ~5-MB-Video ist kein Problem; erst mehrere hundert MB bis GB (oder sehr lange 4K-Videos) können an die Grenze stoßen. In diesem Fall erscheint eine klare Speichermeldung.
- **`file://`-Aufruf:** Die Seite sollte über `http://`/`https://` geladen werden, damit Web Worker und `fetch` funktionieren.
- **CDN-Erreichbarkeit:** FFmpeg wird beim Verarbeiten von einer CDN (jsDelivr) geladen. Ohne Internetverbindung schlägt das Laden fehl – die Fehlermeldung sagt das dann auch klar aus.

---

## 📦 FFmpeg.wasm-Hinweise

- Verwendete Version: **`@ffmpeg/core@0.12.6`** (single-threaded, UMD-Build).
- Der **Wrapper** `@ffmpeg/ffmpeg` und die Utilities `@ffmpeg/util` werden bewusst **nicht** gebraucht – `worker.js` enthält eine kleine eigene `toBlobURL`-/Download-Logik und treibt den Core direkt an. Das ist dasselbe, was ffmpeg.wasm intern in seinem eigenen Worker tut, nur ohne die Cross-Origin-Falle des UMD-Wrappers.
- Sollte die gewählte CDN (jsDelivr) in deiner Region blockiert sein, tausche `CORE_BASE` in `worker.js` einfach auf `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd`.

---

## 📄 Lizenz

Dieses Projekt ist unter der **MIT-Lizenz** veröffentlicht (siehe unten).

**Achtung – FFmpeg-Lizenz:** FFmpeg.wasm (`@ffmpeg/core`) selbst ist unter **GPL-2.0-or-later** lizenziert. Die Nutzung von FFmpeg.wasm in dieser Anwendung bedeutet daher, dass auch die Verwendung der erzeugten Werkzeuge den GPL-Bedingungen unterliegen kann, wenn du FFmpeg-Code vertreibst oder modifizierst. Dieses Repository enthält **keinen** FFmpeg-Quellcode; FFmpeg.wasm wird nur zur Laufzeit von einer CDN nachgeladen. Bitte prüfe die Lizenzen von [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), falls du abgeleitete Projekte kommerziell vertreibst.

### MIT-Lizenz

```
MIT License

Copyright (c) 2026 Video Reverse

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
