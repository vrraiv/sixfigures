// On-page diagnostics, loaded only when the URL hash has `diag` (e.g. /#diag):
// what the graphics driver is, how long frames and input take, what the mouse
// wheel sends, how the load went, what was fetched from where, and where the
// main thread spends its time. For reading on machines without developer tools.
//
// Keys: p starts a 20 s profile of the main thread (needs the Document-Policy:
// js-profiling header, see web/public/_headers); b hides or shows the basemap;
// d hides or shows the DA layers. Drag the map with one hidden to feel which
// side costs the time.

export function diagnostics(map) {
  const box = document.createElement("pre");
  box.className = "diag";
  box.setAttribute("aria-live", "off");
  document.body.append(box);

  const since = (t) => `${(t / 1000).toFixed(1)}s`;
  const marks = {};
  const mark = (k) => () => (marks[k] ??= performance.now());
  map.once("style.load", mark("style"));
  map.once("load", mark("basemap"));
  map.once("idle", mark("idle"));
  map.on("sourcedata", (e) => {
    if (e.sourceId === "da" && e.isSourceLoaded) mark("tiles")();
  });

  // Main-thread frame intervals: a long interval means the page was busy
  // (parsing tiles, drawing) and input queued up meanwhile. The steady interval
  // at rest is the display's refresh period (17 ms at 60 Hz, 33 ms at 30 Hz).
  const frames = [];
  let last = performance.now();
  const tick = (t) => {
    frames.push({ t, dt: t - last });
    last = t;
    while (frames.length > 600) frames.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Every wheel event the map receives, before the zoom handler does.
  const wheels = [];
  map.getContainer().addEventListener("wheel", (e) => {
    wheels.push({ t: e.timeStamp, mode: e.deltaMode, dy: Math.round(e.deltaY * 100) / 100, ctrl: e.ctrlKey });
    while (wheels.length > 200) wheels.shift();
  }, { capture: true, passive: true });

  // Long tasks (main thread busy over 50 ms) and input latency: for each
  // pointer, wheel or key event over 16 ms, how long it waited for the main
  // thread (delay) and how long until the frame that showed its effect (total).
  const longTasks = [];
  const inputs = [];
  const observe = (type, fn, extra = {}) => {
    try {
      new PerformanceObserver((l) => fn(l.getEntries())).observe({ type, buffered: true, ...extra });
    } catch {}
  };
  observe("longtask", (es) => {
    for (const e of es) longTasks.push({ t: e.startTime, ms: e.duration });
    while (longTasks.length > 500) longTasks.shift();
  });
  observe("event", (es) => {
    for (const e of es) {
      if (!/^(pointer|mouse|wheel|key)/.test(e.name)) continue;
      inputs.push({ t: e.startTime, name: e.name, delay: e.processingStart - e.startTime, total: e.duration });
    }
    while (inputs.length > 500) inputs.shift();
  }, { durationThreshold: 16 });

  let renderer = "unknown";
  try {
    const gl = map.getCanvas().getContext("webgl2") ?? map.getCanvas().getContext("webgl");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : `${gl.getParameter(gl.RENDERER)} (masked)`;
  } catch (e) {
    renderer = `error: ${e.message}`;
  }

  // How long the graphics card takes per frame, from a timer query around each
  // of MapLibre's paint passes (EXT_disjoint_timer_query_webgl2, where the driver
  // offers it). The main thread's own time is in the profile; this is the GPU's.
  const gpu = []; // { t, ms }
  let gpuState = "no timer query";
  try {
    const gl = map.painter.context.gl;
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (ext) {
      gpuState = "";
      let pending = null;
      const P = Object.getPrototypeOf(map.painter);
      const paint = P.render;
      P.render = function (...args) {
        if (pending) {
          if (gl.getQueryParameter(pending.q, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push({ t: pending.t, ms: gl.getQueryParameter(pending.q, gl.QUERY_RESULT) / 1e6 });
            gl.deleteQuery(pending.q);
            pending = null;
            while (gpu.length > 600) gpu.shift();
          }
          if (pending) return paint.apply(this, args); // one query in flight at a time
        }
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        try {
          return paint.apply(this, args);
        } finally {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          pending = { q, t: performance.now() };
        }
      };
    }
  } catch (e) {
    gpuState = `timer error: ${e.message}`;
  }
  const gpuStats = (from) => {
    const xs = gpu.filter((g) => g.t >= from).map((g) => g.ms).sort((a, b) => a - b);
    return xs.length ? `median ${xs[xs.length >> 1].toFixed(1)} ms, worst ${xs[xs.length - 1].toFixed(1)} ms over ${xs.length} frames` : gpuState || "no frames yet";
  };

  // A fixed piece of arithmetic, timed: how fast this machine runs JavaScript on
  // one thread. About 45 ms on a fast 2024 desktop; the number is only useful
  // against another machine's.
  const cpuIndex = (() => {
    const t0 = performance.now();
    let x = 1;
    for (let i = 0; i < 1e7; i++) x = (x * 1103515245 + 12345) & 0x7fffffff;
    const ms = performance.now() - t0;
    return x ? `${ms.toFixed(0)} ms` : "?"; // x keeps the loop from being optimised away
  })();

  // What the page fetched, grouped by origin (our tiles apart), from the Resource
  // Timing API: requests, bytes on the wire (0 where another origin doesn't allow
  // timing, or from cache), and when the first started and the last finished.
  performance.setResourceTimingBufferSize?.(2000);
  let networkLines = [];
  let networkAt = -Infinity;
  function network() {
    if (performance.now() - networkAt < 2000) return networkLines;
    networkAt = performance.now();
    const groups = {};
    for (const r of performance.getEntriesByType("resource")) {
      let host;
      try { host = new URL(r.name).host; } catch { continue; }
      const key = host !== location.host ? host : r.name.includes("/tiles/") ? "DA tiles" : "page";
      const g = (groups[key] ??= { n: 0, bytes: 0, start: Infinity, end: 0 });
      g.n++;
      g.bytes += r.transferSize || 0;
      g.start = Math.min(g.start, r.startTime);
      g.end = Math.max(g.end, r.responseEnd);
    }
    networkLines = Object.entries(groups).map(([k, g]) =>
      `  ${k}: ${g.n} requests, ${(g.bytes / 1024).toFixed(0)} KB, ${since(g.start)}–${since(g.end)}`);
    return networkLines;
  }
  const conn = navigator.connection;
  const link = conn ? `${conn.effectiveType ?? "?"}, ~${conn.downlink ?? "?"} Mb/s, rtt ~${conn.rtt ?? "?"} ms` : "n/a";

  // ---- profile: where the main thread's time goes, sampled every 10 ms -------
  // Needs the JS Self-Profiling API (Chrome and Edge 94+, with the Document-
  // Policy header); the report lists the functions with the most own time.
  const PROFILE_MS = 20000;
  let profiler = null;
  let profileEnds = 0;
  let profileLines = [typeof Profiler === "function" ? "profile: press p, then drag and zoom for 20 s" : "profile: not available (no Profiler API or header)"];
  async function startProfile() {
    if (typeof Profiler !== "function" || profiler) return;
    try {
      profiler = new Profiler({ sampleInterval: 10, maxBufferSize: PROFILE_MS / 10 + 100 });
    } catch (e) {
      profileLines = [`profile: ${e.message}`];
      return;
    }
    const from = performance.now();
    profileEnds = from + PROFILE_MS;
    setTimeout(async () => {
      const trace = await profiler.stop();
      profiler = null;
      profileLines = [...during(from, performance.now()), ...summarize(trace)];
    }, PROFILE_MS);
  }
  // What happened while the profile ran, kept on screen after it: frames shown,
  // long tasks, slow input and GPU time are otherwise gone from the rolling
  // lines by the time a photo is taken.
  function during(from, to) {
    const secs = (to - from) / 1000;
    const shown = frames.filter((f) => f.t >= from && f.t <= to);
    const worstFrame = Math.max(0, ...shown.map((f) => f.dt));
    const lt = longTasks.filter((l) => l.t >= from && l.t <= to);
    const ltSum = lt.reduce((a, l) => a + l.ms, 0);
    const ins = inputs.filter((i) => i.t >= from && i.t <= to);
    const slowest = ins.reduce((a, b) => (b.total > (a?.total ?? 0) ? b : a), null);
    return [
      `during the profile (${secs.toFixed(0)} s):`,
      `  frames shown: ${shown.length} (${(shown.length / secs).toFixed(0)} per s), worst gap ${worstFrame.toFixed(0)} ms`,
      `  long tasks: ${lt.length}, ${(ltSum / 1000).toFixed(1)} s in all, longest ${Math.max(0, ...lt.map((l) => l.ms)).toFixed(0)} ms`,
      `  slow input events: ${ins.length}${slowest ? `, slowest ${slowest.name} waited ${slowest.delay.toFixed(0)} ms, shown after ${slowest.total.toFixed(0)} ms` : ""}`,
      `  gpu per frame: ${gpuStats(from)}`,
    ];
  }
  function summarize(trace) {
    const { frames: fr, stacks, samples, resources } = trace;
    const own = new Map(); // leaf frame id -> samples
    let idle = 0;
    const seen = new Map(); // frame key -> samples anywhere on the stack
    for (const s of samples) {
      if (s.stackId == null) { idle++; continue; }
      let st = stacks[s.stackId];
      own.set(st.frameId, (own.get(st.frameId) ?? 0) + 1);
      const onStack = new Set();
      for (; st; st = st.parentId == null ? null : stacks[st.parentId]) onStack.add(st.frameId);
      for (const f of onStack) seen.set(f, (seen.get(f) ?? 0) + 1);
    }
    const n = samples.length || 1;
    // The browser samples at its own pace (often 16 ms, not the 10 asked for).
    const span = n > 1 ? samples[n - 1].timestamp - samples[0].timestamp : 0;
    const per = span / Math.max(1, n - 1);
    const ms = (k) => `${(k * per).toFixed(0).padStart(5)} ms`;
    const name = (id) => {
      const f = fr[id];
      const file = f.resourceId == null ? "" : (resources[f.resourceId] ?? "").split("/").pop().split("?")[0];
      const where = file ? ` ${file}:${f.line}:${f.column}` : "";
      return `${file.startsWith("diag") ? "overlay: " : ""}${f.name || "(anonymous)"}${where}`;
    };
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, k]) => `  ${ms(k)} ${name(id)}`);
    return [
      `profile (${(span / 1000).toFixed(0)} s, one sample per ${per.toFixed(0)} ms): main thread busy ${(100 - idle / n * 100).toFixed(0)}%, idle ${(idle / n * 100).toFixed(0)}%`,
      "own time:",
      ...top(own),
      "on the stack:",
      ...top(seen).slice(0, 6),
    ];
  }

  // ---- keys: p profile, b basemap, d DA layers ---------------------------------
  const hidden = { basemap: false, da: false };
  const layersOf = (which) => map.getStyle().layers.filter((l) => (which === "da" ? ["da", "da16", "ov"].includes(l.source) : l.source === "openmaptiles"));
  const saved = {};
  function toggle(which) {
    hidden[which] = !hidden[which];
    for (const l of layersOf(which)) {
      if (hidden[which]) {
        saved[l.id] = map.getLayoutProperty(l.id, "visibility") ?? "visible";
        map.setLayoutProperty(l.id, "visibility", "none");
      } else {
        map.setLayoutProperty(l.id, "visibility", saved[l.id] ?? "visible");
      }
    }
  }
  window.addEventListener("keydown", (e) => {
    if (e.target !== document.body && e.target !== map.getCanvas()) return;
    if (e.key === "p") startProfile();
    else if (e.key === "b") toggle("basemap");
    else if (e.key === "d") toggle("da");
  });

  function render() {
    const now = performance.now();
    const recent = frames.slice(-60);
    const avg = recent.reduce((a, b) => a + b.dt, 0) / (recent.length || 1);
    const worst = Math.max(0, ...recent.map((f) => f.dt));
    const worst10 = Math.max(0, ...frames.filter((f) => now - f.t < 10000).map((f) => f.dt));
    const lt10 = longTasks.filter((l) => now - l.t < 10000);
    const ltWorst = Math.max(0, ...lt10.map((l) => l.ms));
    const in10 = inputs.filter((i) => now - i.t < 10000);
    const slowest = in10.reduce((a, b) => (b.total > (a?.total ?? 0) ? b : a), null);
    const lastSec = wheels.filter((w) => now - w.t < 1000).length;
    const tail = wheels.slice(-8).map((w) => `${w.mode === 1 ? "line" : w.mode === 2 ? "page" : "px"} ${w.dy}${w.ctrl ? " ctrl" : ""}`).join(", ");
    const gaps = wheels.slice(-8).map((w, i, a) => (i ? Math.round(w.t - a[i - 1].t) : 0)).slice(1).join("/");
    const at = (k) => (marks[k] ? since(marks[k]) : "…");
    const state = [hidden.basemap && "basemap hidden", hidden.da && "DA layers hidden"].filter(Boolean).join(", ");
    box.textContent = [
      `renderer: ${renderer}`,
      `cpu threads: ${navigator.hardwareConcurrency ?? "?"} · cpu index: ${cpuIndex} · dpr: ${devicePixelRatio} · ${innerWidth}×${innerHeight} of ${screen.width}×${screen.height} · link: ${link}`,
      `load: style ${at("style")} · basemap ${at("basemap")} · DA tiles ${at("tiles")} · first idle ${at("idle")}`,
      "fetched:",
      ...network(),
      `frames: avg ${avg.toFixed(0)} ms, worst ${worst.toFixed(0)} ms (last 60) · worst ${worst10.toFixed(0)} ms (last 10 s)`,
      `long tasks: ${longTasks.length} total, ${lt10.length} in last 10 s, longest ${ltWorst.toFixed(0)} ms · last: ${longTasks.slice(-5).map((l) => l.ms.toFixed(0)).join("/") || "—"}`,
      `input (last 10 s): ${in10.length} slow events · slowest ${slowest ? `${slowest.name} waited ${slowest.delay.toFixed(0)} ms, shown after ${slowest.total.toFixed(0)} ms` : "—"}`,
      `gpu per frame (last 10 s): ${gpuStats(now - 10000)}`,
      `zoom: ${map.getZoom().toFixed(2)}${map.isZooming() ? " (zooming)" : ""} · wheel events: ${wheels.length} total, ${lastSec} in last 1 s`,
      `last wheel deltas: ${tail || "—"}`,
      `gaps between them (ms): ${gaps || "—"}`,
      profiler ? `profile: recording, ${Math.max(0, (profileEnds - now) / 1000).toFixed(0)} s left — drag and zoom now` : profileLines.join("\n"),
      `keys: p profile · b basemap · d DA layers${state ? ` · ${state}` : ""}`,
      navigator.userAgent,
    ].join("\n");
  }
  setInterval(render, 250);
  render();
}
