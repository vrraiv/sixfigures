// On-page diagnostics, loaded only when the URL hash has `diag` (e.g. /#diag):
// what the graphics driver is, how long frames take, what the mouse wheel sends,
// how the load went and what was fetched from where. For reading on machines
// without developer tools.

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

  // Main-thread frame intervals over the last second: a long interval means the
  // page was busy (parsing tiles, drawing) and input queued up meanwhile.
  const frames = [];
  let last = performance.now();
  const tick = (t) => {
    frames.push(t - last);
    last = t;
    while (frames.length > 120) frames.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Every wheel event the map receives, before the zoom handler does.
  const wheels = [];
  map.getContainer().addEventListener("wheel", (e) => {
    wheels.push({ t: e.timeStamp, mode: e.deltaMode, dy: Math.round(e.deltaY * 100) / 100, ctrl: e.ctrlKey });
    while (wheels.length > 200) wheels.shift();
  }, { capture: true, passive: true });

  let longTasks = 0;
  try {
    new PerformanceObserver((l) => (longTasks += l.getEntries().length)).observe({ type: "longtask" });
  } catch {}

  let renderer = "unknown";
  try {
    const gl = map.getCanvas().getContext("webgl2") ?? map.getCanvas().getContext("webgl");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : `${gl.getParameter(gl.RENDERER)} (masked)`;
  } catch (e) {
    renderer = `error: ${e.message}`;
  }

  // What the page fetched, grouped by origin (our tiles apart), from the Resource
  // Timing API: requests, bytes on the wire (0 where another origin doesn't allow
  // timing), and when the first started and the last finished.
  performance.setResourceTimingBufferSize?.(2000);
  function network() {
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
    return Object.entries(groups).map(([k, g]) =>
      `  ${k}: ${g.n} requests, ${(g.bytes / 1024).toFixed(0)} KB, ${since(g.start)}–${since(g.end)}`);
  }
  const conn = navigator.connection;
  const link = conn ? `${conn.effectiveType ?? "?"}, ~${conn.downlink ?? "?"} Mb/s, rtt ~${conn.rtt ?? "?"} ms` : "n/a";

  function render() {
    const now = performance.now();
    const recent = frames.slice(-60);
    const avg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
    const worst = Math.max(0, ...recent);
    const lastSec = wheels.filter((w) => now - w.t < 1000).length;
    const tail = wheels.slice(-8).map((w) => `${w.mode === 1 ? "line" : w.mode === 2 ? "page" : "px"} ${w.dy}${w.ctrl ? " ctrl" : ""}`).join(", ");
    const gaps = wheels.slice(-8).map((w, i, a) => (i ? Math.round(w.t - a[i - 1].t) : 0)).slice(1).join("/");
    const at = (k) => (marks[k] ? since(marks[k]) : "…");
    box.textContent = [
      `renderer: ${renderer}`,
      `cpu threads: ${navigator.hardwareConcurrency ?? "?"} · dpr: ${devicePixelRatio} · ${innerWidth}×${innerHeight} · link: ${link}`,
      `load: style ${at("style")} · basemap ${at("basemap")} · DA tiles ${at("tiles")} · first idle ${at("idle")}`,
      "fetched:",
      ...network(),
      `frames (last 60): avg ${avg.toFixed(0)} ms, worst ${worst.toFixed(0)} ms · long tasks: ${longTasks}`,
      `zoom: ${map.getZoom().toFixed(2)}${map.isZooming() ? " (zooming)" : ""} · wheel events: ${wheels.length} total, ${lastSec} in last 1 s`,
      `last wheel deltas: ${tail || "—"}`,
      `gaps between them (ms): ${gaps || "—"}`,
      navigator.userAgent,
    ].join("\n");
  }
  setInterval(render, 250);
  render();
}
