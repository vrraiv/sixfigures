// Low-detail mode, for machines that draw the map in software: a browser with
// graphics acceleration switched off by policy, or an old integrated chip.
// There every frame costs pixels × passes, so the map draws on a smaller
// canvas, the basemap loses the layers that show least under the DA fills, the
// DA outlines go below z13, and the highlight outline draws only for a pinned
// or opened DA. Under SwiftShader pinned to four cores a frame went from 91 ms
// to 25; on the laptop that prompted this, from about 300 ms.
//
// The mode is chosen in this order: q=low or q=full in the URL hash (kept for
// later visits), the choice kept from an earlier visit, or a measurement of the
// first frames after the map has loaded (calibrate), which keeps "low" only.

export const RATIO = 0.6; // canvas pixels per CSS pixel in low detail
export const LINE_MINZOOM = 13; // DA outlines appear from this zoom in low detail
export const SLOW_MS = 60; // a median frame slower than this (33 ms on a 30 Hz display) means software drawing
const KEY = "map-detail";

export const detail = { low: false, source: "", measured: null };

// Basemap layers that cost most and show least: fills under the DA colours,
// minor roads, road casings and the subtle duplicates of major roads.
const PRUNE = new Set(["park", "landcover_wood", "building", "landuse_residential", "aeroway-area", "road_area_pier"]);
const prune = (l) => l.source === "openmaptiles" && (PRUNE.has(l.id) || /^(highway_path|highway_minor|road_pier|aeroway|railway|tunnel)/.test(l.id) || /subtle|casing/.test(l.id));

const store = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

export function initDetail(hashParams) {
  const q = hashParams.get("q");
  let choice = null;
  if (q === "low" || q === "full") {
    choice = q;
    detail.source = "link";
    store(q);
  } else {
    try { choice = localStorage.getItem(KEY); } catch {}
    if (choice === "low" || choice === "full") {
      detail.source = "kept";
    } else if (choice?.startsWith("low@") && Date.now() - Number(choice.slice(4)) < MEASURED_FOR) {
      choice = "low"; // measured on an earlier visit; measured again once it is this old
      detail.source = "kept";
    } else {
      choice = null;
    }
  }
  detail.low = choice === "low";
  return detail;
}

const MEASURED_FOR = 7 * 24 * 3600 * 1000;

// A choice made by the reader is kept; one measured is kept a week.
export function remember(low, measured = false) {
  store(low ? (measured ? `low@${Date.now()}` : "low") : "full");
}

export function applyBasemap(map, low) {
  for (const l of map.getStyle().layers) {
    if (prune(l)) map.setLayoutProperty(l.id, "visibility", low ? "none" : "visible");
  }
}

// The median interval between frames, first with the map at rest (the display's
// refresh period, or a browser's throttling of a covered tab) and then while
// the map repaints every frame: a few ms to 33 on a graphics card, hundreds in
// software. Only a slow repaint over a normal rest interval means slow drawing.
export function calibrate(map, frames = 6) {
  const gaps = (repaint) => new Promise((resolve) => {
    const xs = [];
    let last = null;
    const tick = (t) => {
      if (last != null) xs.push(t - last);
      last = t;
      if (xs.length >= frames) {
        xs.sort((a, b) => a - b);
        resolve(xs[xs.length >> 1]);
        return;
      }
      if (repaint) map.triggerRepaint();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return gaps(false).then(async (rest) => ({ rest, repaint: rest < THROTTLED_MS ? await gaps(true) : null }));
}
export const THROTTLED_MS = 70; // a rest interval over this is a throttled tab, not a display
export const isSlow = (m) => m.repaint != null && m.repaint > SLOW_MS;
