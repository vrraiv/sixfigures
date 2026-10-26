// Compose shareable PNGs of the map: any rectangle of the view (like a snipping
// tool) plus optional title, legend, the selected DA's figures and a label on
// that DA. Everything is drawn in plain sRGB with dark text so the result stays
// legible wherever it is pasted (system screen captures on HDR/wide-gamut
// displays can blow out the light blues).

const INK = "#1a1a19", INK2 = "#4b4b47", INK3 = "#6b6b66", RULE = "#e2e2dd", SURFACE = "#fcfcfb";
const ACCENT = "#eb6834", HIGHLIGHT = "#eef4fc";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD = 14;
const SIDE_W = 260;      // details panel width when placed beside the map
const SIDE_MIN_MAP = 420; // narrower snips get the panel below instead

const nextRender = (map) => new Promise((resolve) => { map.once("render", resolve); map.triggerRepaint(); });
const idle = (map) => new Promise((resolve) => (map.loaded() && !map.isMoving() ? resolve() : map.once("idle", resolve)));

/**
 * Copy the WebGL canvas during a render, while its drawing buffer is still
 * valid (so the map needs no preserveDrawingBuffer). scale > 1 re-renders the
 * map at a higher pixel ratio for a sharper image, then restores it.
 * Returns { canvas, ratio } where ratio = image pixels per CSS pixel.
 */
export async function grabMap(map, scale = 1) {
  const original = map.getPixelRatio();
  if (scale !== 1) {
    map.setPixelRatio(original * scale);
    await idle(map);
  }
  const grab = new Promise((resolve) => {
    map.once("render", () => {
      const src = map.getCanvas();
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      c.getContext("2d").drawImage(src, 0, 0);
      resolve({ canvas: c, ratio: src.width / src.clientWidth });
    });
  });
  map.triggerRepaint();
  const out = await grab;
  if (scale !== 1) {
    map.setPixelRatio(original);
    await nextRender(map);
  }
  return out;
}

function font(ctx, size, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

// Draw (or with draw=false just measure) wrapped text; returns the y below it.
function wrap(ctx, text, x, y, maxW, lineH, draw = true) {
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      if (draw) ctx.fillText(line, x, y);
      y += lineH;
      line = word;
    } else {
      line = test;
    }
  }
  if (line && draw) ctx.fillText(line, x, y);
  return y + lineH;
}

function swatch(ctx, it, x, y) {
  if (it.hatch) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 18, 12);
    ctx.clip();
    ctx.fillStyle = "#e4e4e0";
    ctx.fillRect(x, y, 18, 12);
    ctx.strokeStyle = "#9a9a95";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let o = -12; o < 24; o += 5) { ctx.moveTo(x + o, y + 12); ctx.lineTo(x + 12 + o, y); }
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.fillStyle = it.color;
    ctx.fillRect(x, y, 18, 12);
  }
}

// Legend as a strip that flows into rows to fit any width.
function legendStrip(ctx, legend, x, y, w, draw) {
  font(ctx, 12.5, 650);
  if (draw) { ctx.fillStyle = INK; ctx.fillText(legend.title, x, y + 12); }
  let cy = y + 22, cx = x;
  font(ctx, 12);
  for (const it of legend.items) {
    const iw = 18 + 6 + ctx.measureText(it.label).width + 14;
    if (cx + iw > x + w && cx > x) { cx = x; cy += 20; }
    if (draw) {
      swatch(ctx, it, cx, cy);
      ctx.fillStyle = INK2;
      ctx.fillText(it.label, cx + 24, cy + 11);
    }
    cx += iw;
  }
  cy += 22;
  font(ctx, 12, 600);
  if (draw) { ctx.fillStyle = INK; ctx.fillText(legend.footer, x, cy + 8); }
  return cy + 16;
}

// DA figures; returns the y below the panel.
function panel(ctx, d, x, y, w, draw) {
  const inner = w;
  let cy = y + 14;
  if (d.note) {
    font(ctx, 12);
    if (draw) { ctx.fillStyle = ACCENT; ctx.fillRect(x, cy - 12, 3, 16); ctx.fillStyle = INK2; }
    cy = wrap(ctx, d.note, x + 10, cy, inner - 10, 16, draw) + 6;
  }
  font(ctx, 16, 700);
  if (draw) { ctx.fillStyle = INK; ctx.fillText(d.heading, x, cy + 4); }
  cy += 24;
  font(ctx, 12.5);
  if (draw) ctx.fillStyle = INK2;
  cy = wrap(ctx, d.sub, x, cy, inner, 16, draw) + 6;
  font(ctx, 11, 600);
  if (draw) {
    ctx.fillStyle = INK3;
    ctx.textAlign = "right";
    ctx.fillText("Median", x + w - 70, cy);
    ctx.fillText("Percentile", x + w, cy);
    ctx.textAlign = "left";
  }
  cy += 6;
  for (const r of d.rows) {
    if (draw) {
      if (r.selected) { ctx.fillStyle = HIGHLIGHT; ctx.fillRect(x - 4, cy, inner + 8, 24); }
      font(ctx, 12.5, r.selected ? 700 : 400);
      ctx.fillStyle = r.selected ? INK : INK2;
      ctx.fillText(r.label, x, cy + 16);
      ctx.textAlign = "right";
      ctx.fillStyle = INK;
      ctx.fillText(r.value, x + w - 70, cy + 16);
      ctx.fillText(r.pct, x + w, cy + 16);
      ctx.textAlign = "left";
      ctx.fillStyle = RULE;
      ctx.fillRect(x, cy + 24, inner, 1);
    }
    cy += 24;
  }
  cy += 20;
  font(ctx, 12.5);
  for (const line of d.lines) {
    if (draw) ctx.fillStyle = line.note ? INK2 : INK;
    cy = wrap(ctx, line.text, x, cy, inner, 17, draw) + 2;
  }
  font(ctx, 11);
  if (draw) ctx.fillStyle = INK3;
  for (const f of d.fine) cy = wrap(ctx, f, x, cy + 4, inner, 14, draw);
  return cy;
}

// Callout naming the selected DA, pointing at a spot inside it.
function daLabel(ctx, label, px, py, mapW, mapH) {
  font(ctx, 13, 700);
  const w1 = ctx.measureText(label.title).width;
  font(ctx, 12);
  const lines = label.lines;
  const w = Math.max(w1, ...lines.map((l) => ctx.measureText(l).width)) + 20;
  const h = 22 + lines.length * 16 + 6;
  // Prefer up-right of the point; flip to stay inside the map image.
  let bx = px + 14, by = py - h - 14;
  if (bx + w > mapW - 4) bx = px - 14 - w;
  if (by < 4) by = py + 14;
  bx = Math.max(4, Math.min(bx, mapW - w - 4));
  by = Math.max(4, Math.min(by, mapH - h - 4));
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(Math.max(bx, Math.min(px, bx + w)), Math.max(by, Math.min(py, by + h)));
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = INK;
  font(ctx, 13, 700);
  ctx.fillText(label.title, bx + 10, by + 18);
  font(ctx, 12);
  ctx.fillStyle = INK2;
  lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 36 + i * 16));
  dot(ctx, px, py);
}

function dot(ctx, x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
}

/**
 * Compose the PNG canvas.
 * opts: {
 *   grab: { canvas, ratio },            from grabMap()
 *   region: { x, y, w, h },             CSS px within the map
 *   project: (lngLat) => {x, y},        map.project
 *   include: { title, legend, details, label },
 *   title, subtitle, url, credits: [string],
 *   legend: { title, items, footer },
 *   details?: panel data, label?: { lngLat, title, lines }, pin?: [lng, lat]
 * }
 * Returns { canvas, labelHidden } (labelHidden: the DA point lies outside the region).
 */
export function compose(opts) {
  const { grab, region, include } = opts;
  const r = grab.ratio;
  const mapW = region.w, mapH = region.h;
  const details = include.details && opts.details;
  const side = details && mapW >= SIDE_MIN_MAP;
  const W = mapW + (side ? SIDE_W + PAD : 0);
  const innerW = W - PAD * 2;
  const probe = document.createElement("canvas").getContext("2d");

  // Title block wraps to the image width; returns the y below it.
  const header = (ctx, draw) => {
    font(ctx, 16, 700);
    if (draw) ctx.fillStyle = INK;
    let y = wrap(ctx, opts.title, PAD, 24, innerW, 20, draw);
    font(ctx, 12.5);
    if (draw) ctx.fillStyle = INK2;
    y = wrap(ctx, opts.subtitle, PAD, y - 2, innerW, 16, draw);
    return y - 2;
  };
  const credits = [...opts.credits, opts.url];
  const headH = include.title ? header(probe, false) : 0;
  const sideH = side ? panel(probe, details, 0, 0, SIDE_W - PAD, false) + PAD : 0;
  const mapBlockH = Math.max(mapH, sideH);
  const legendH = include.legend ? legendStrip(probe, opts.legend, 0, 0, innerW, false) + PAD : 0;
  const belowH = details && !side ? panel(probe, details, 0, 0, innerW, false) + PAD : 0;
  font(probe, 10.5);
  const creditsH = credits.reduce((y, c) => wrap(probe, c, 0, y, innerW, 13, false), 0) + PAD;
  const H = headH + mapBlockH + PAD + legendH + belowH + creditsH;

  const out = document.createElement("canvas");
  out.width = Math.round(W * r);
  out.height = Math.round(H * r);
  const ctx = out.getContext("2d", { colorSpace: "srgb" });
  ctx.scale(r, r);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, W, H);

  if (include.title) header(ctx, true);

  // Map crop, with its own clip so overlays never spill outside it.
  const my = headH;
  ctx.drawImage(grab.canvas, region.x * r, region.y * r, region.w * r, region.h * r, 0, my, mapW, mapH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, my, mapW, mapH);
  ctx.clip();
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= mapW && p.y <= mapH;
  const at = (lngLat) => { const p = opts.project(lngLat); return { x: p.x - region.x, y: p.y - region.y }; };
  if (opts.pin) {
    const p = at(opts.pin);
    if (inside(p)) dot(ctx, p.x, my + p.y);
  }
  let labelHidden = false;
  if (include.label && opts.label) {
    const p = at(opts.label.lngLat);
    if (inside(p)) {
      ctx.translate(0, my);
      daLabel(ctx, opts.label, p.x, p.y, mapW, mapH);
      ctx.translate(0, -my);
    } else {
      labelHidden = true;
    }
  }
  ctx.restore();
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, my + 0.5, mapW - 1, mapH - 1);

  if (side) panel(ctx, details, mapW + PAD, my, SIDE_W - PAD, true);

  let y = my + mapBlockH + PAD;
  if (include.legend) y = legendStrip(ctx, opts.legend, PAD, y, innerW, true) + PAD;
  if (details && !side) y = panel(ctx, details, PAD, y - 8, innerW, true) + PAD;
  ctx.fillStyle = RULE;
  ctx.fillRect(0, y - PAD / 2, W, 1);
  font(ctx, 10.5);
  ctx.fillStyle = INK3;
  let fy = y + 8;
  for (const c of credits) fy = wrap(ctx, c, PAD, fy, innerW, 13);

  return { canvas: out, labelHidden };
}

export const toBlob = (canvas) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
