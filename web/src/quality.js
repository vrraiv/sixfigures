// Map detail, for machines that draw the map in software: a browser with
// graphics acceleration switched off by policy, or an old integrated chip.
// There every frame costs pixels × passes plus vertices, so the lower levels
// draw on a smaller canvas, drop the basemap layers that show least under the
// DA fills, start the DA outlines at z12, and draw the highlight outline only
// for a selected or pinned DA. Under SwiftShader pinned to four cores a frame
// went from 91 ms at full to about 31 at medium and 27 at low; on the laptop
// that prompted this, from about 300 ms.
//
// The level comes from q=auto|full|medium|low in the URL hash, the footer's
// "Map detail" buttons, or (auto) a measurement after the map's first idle.
// A chosen level is kept; a measured one is kept a week, and the auto button
// measures again at once. detailControls wires all of that to a map and its
// page; the page supplies what its own layers need on a change of level.

export const LEVELS = {
  full: { ratio: null, prune: false, lineMinzoom: 0, outline: true },
  medium: { ratio: 0.8, prune: true, lineMinzoom: 12, outline: false },
  low: { ratio: 0.67, prune: true, lineMinzoom: 12, outline: false },
};
// outline: the highlight layer that outlines every DA on hover (a pass over all
// of them each frame); without it the hovered DA pales instead.
export const detail = { level: "full", mode: "auto", source: "", measured: null };
// mode: "auto" or "chosen"; source: how the level was arrived at: "link",
// "kept", "measured", "measuring", "throttled" or "" (not yet).

const KEY = "map-detail";
const MEASURED_FOR = 7 * 24 * 3600 * 1000;
const store = (v) => { try { v == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch {} };

export const cfg = () => LEVELS[detail.level];

export function initDetail(hashParams) {
  const q = hashParams.get("q");
  let v = null;
  if (q in LEVELS) {
    v = q;
    detail.source = "link";
    store(q);
  } else if (q === "auto") {
    store(null); // measure afresh
  } else {
    try { v = localStorage.getItem(KEY); } catch {}
    detail.source = "kept";
  }
  if (v in LEVELS) {
    detail.level = v;
    detail.mode = "chosen";
    return detail;
  }
  const [, level, at] = /^auto:(\w+)@(\d+)$/.exec(v ?? "") ?? [];
  if (level in LEVELS && Date.now() - Number(at) < MEASURED_FOR) detail.level = level; // measured on an earlier visit
  else detail.source = ""; // nothing kept: measured after the first idle
  return detail;
}

export function remember(level, mode) {
  store(mode === "chosen" ? level : `auto:${level}@${Date.now()}`);
}
export function forget() {
  store(null);
}

// Basemap layers that cost most and show least: fills under the DA colours,
// minor roads, road casings and the subtle duplicates of major roads.
const PRUNE = new Set(["park", "landcover_wood", "building", "landuse_residential", "aeroway-area", "road_area_pier"]);
const prune = (l) => l.source === "openmaptiles" && (PRUNE.has(l.id) || /^(highway_path|highway_minor|road_pier|aeroway|railway|tunnel)/.test(l.id) || /subtle|casing/.test(l.id));

export function applyBasemap(map, pruned) {
  for (const l of map.getStyle().layers) {
    if (prune(l)) map.setLayoutProperty(l.id, "visibility", pruned ? "none" : "visible");
  }
}

// The median interval between frames, first with the map at rest (the display's
// refresh period, or a browser's throttling of a covered tab) and then while
// the map repaints every frame: a few ms to 33 on a graphics card, hundreds in
// software. Only a slow repaint over a normal rest interval means slow drawing.
// The rest sample waits for the map to be still and loaded, and starts over if
// a drag or a tile arrival repaints it meanwhile; if that keeps happening for
// `patience` ms the result is { rest: null, repaint: null }.
export function calibrate(map, frames = 8, patience = 15000) {
  const gaps = (repaint) => new Promise((resolve) => {
    const xs = [];
    let last = null;
    const tick = (t) => {
      if (last != null) xs.push(t - last);
      last = t;
      if (!repaint && (map.isMoving() || !map.loaded())) { resolve(null); return; } // disturbed: try again
      if (xs.length >= frames) {
        xs.shift(); // the first interval is a warm-up
        xs.sort((a, b) => a - b);
        resolve(xs[xs.length >> 1]);
        return;
      }
      if (repaint) map.triggerRepaint();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const still = () => new Promise((r) => (map.loaded() && !map.isMoving() ? r() : map.once("idle", r)));
  return (async () => {
    const until = performance.now() + patience;
    let rest = null;
    while (rest == null && performance.now() < until) {
      await still();
      rest = await gaps(false);
    }
    if (rest == null) return { rest: null, repaint: null }; // never still long enough
    return { rest, repaint: rest < THROTTLED_MS ? await gaps(true) : null };
  })();
}
export const THROTTLED_MS = 70; // a rest interval over this is a throttled tab, not a display

// The level a measurement calls for, from how much longer a repainted frame
// takes than the display's own interval: null when it could not be measured.
export function levelFor(m) {
  if (m.repaint == null) return null;
  const extra = m.repaint - m.rest;
  return extra > 90 ? "low" : extra > 30 ? "medium" : "full";
}

// The footer's "Map detail: auto · full · medium · low" buttons and the note
// beside them, and the measurement after the first idle. `apply(level config)`
// is the page's part: its own layers' zoom ranges and highlights.
export function detailControls(map, { apply }) {
  const buttons = document.querySelectorAll("#detail button");
  const note = document.getElementById("detail-note");

  function applyDetail() {
    const c = cfg();
    map.setPixelRatio(c.ratio ?? devicePixelRatio);
    applyBasemap(map, c.prune);
    apply(c);
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(detail.mode === "auto" ? b.value === "auto" : b.value === detail.level));
    }
    if (note) note.textContent = detailNote();
  }

  // What is on and why, so an automatic switch is not silent.
  function detailNote() {
    const { level, mode, source, measured } = detail;
    if (mode === "chosen") return `${level[0].toUpperCase()}${level.slice(1)} detail, chosen here. Auto measures this device instead.`;
    if (source === "measuring") return "Auto: measuring how fast this device draws the map…";
    if (source === "throttled") return "Auto: could not measure (the tab was in the background, or the map never held still); full detail for now. If the map feels slow, choose medium or low.";
    if (source === "kept" && level !== "full") return `Auto: ${level} detail, as measured on an earlier visit. This device draws the map slowly.`;
    if (level === "full") return "Auto: full detail. Medium and low are for machines that draw the map slowly.";
    const ms = measured?.repaint ? ` (about ${Math.round(measured.repaint)} ms a frame at full detail)` : "";
    return `Auto switched to ${level} detail: this device draws the map slowly${ms}.`;
  }

  function setDetail(level, mode, source) {
    detail.level = level;
    detail.mode = mode;
    detail.source = source;
    remember(level, mode);
    applyDetail();
  }

  // Measures the device and applies what it calls for; the auto button and, with
  // nothing chosen or kept, the first idle after loading.
  async function autoDetail() {
    forget();
    detail.mode = "auto";
    detail.source = "measuring";
    detail.level = "full"; // measured at full detail, whatever was on
    applyDetail();
    // A hidden or covered tab gets no frames to time; a covered one may not
    // say so, so a throttled reading gets a second try before it stands.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (document.hidden) await new Promise((r) => document.addEventListener("visibilitychange", r, { once: true }));
      detail.measured = await calibrate(map);
      const level = levelFor(detail.measured);
      if (level) {
        setDetail(level, "auto", "measured");
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    detail.source = "throttled";
    applyDetail();
  }

  for (const b of buttons) {
    b.addEventListener("click", () => (b.value === "auto" ? autoDetail() : setDetail(b.value, "chosen", "chosen")));
  }
  // With nothing chosen or kept, the first frames after loading decide.
  map.once("load", () => map.once("idle", () => {
    if (detail.mode === "auto" && !detail.source) autoDetail();
  }));

  return { apply: applyDetail, set: setDetail, auto: autoDetail };
}
