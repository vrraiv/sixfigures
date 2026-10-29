// On-page diagnostics, loaded only when the URL hash has `diag` (e.g. /#diag):
// what the graphics driver is, how long frames take, what the mouse wheel sends
// and how the load went. For reading on machines without developer tools.

export function diagnostics(map) {
  const box = document.createElement("pre");
  box.className = "diag";
  box.setAttribute("aria-live", "off");
  document.body.append(box);

  const t0 = performance.timeOrigin;
  const since = (t) => `${((t - t0) / 1000).toFixed(1)}s`;
  const marks = { start: t0 };
  map.once("load", () => (marks.style = performance.timeOrigin + performance.now()));
  map.once("idle", () => (marks.idle = performance.timeOrigin + performance.now()));
  map.on("sourcedata", (e) => {
    if (e.sourceId === "da" && e.isSourceLoaded && !marks.tiles) marks.tiles = performance.timeOrigin + performance.now();
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

  // Every wheel event the map receives, before MapLibre handles it.
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

  function render() {
    const now = performance.now();
    const recent = frames.slice(-60);
    const avg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
    const worst = Math.max(0, ...recent);
    const lastSec = wheels.filter((w) => now - w.t < 1000).length;
    const tail = wheels.slice(-8).map((w) => `${w.mode === 1 ? "line" : w.mode === 2 ? "page" : "px"} ${w.dy}${w.ctrl ? " ctrl" : ""}`).join(", ");
    const gaps = wheels.slice(-8).map((w, i, a) => (i ? Math.round(w.t - a[i - 1].t) : 0)).slice(1).join("/");
    box.textContent = [
      `renderer: ${renderer}`,
      `cpu threads: ${navigator.hardwareConcurrency ?? "?"} · dpr: ${devicePixelRatio} · ${innerWidth}×${innerHeight}`,
      `load: style ${marks.style ? since(marks.style) : "…"} · DA tiles ${marks.tiles ? since(marks.tiles) : "…"} · first idle ${marks.idle ? since(marks.idle) : "…"}`,
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
