// Compose a shareable PNG: the current map view plus title, legend, the selected
// DA's figures and attribution, drawn with plain sRGB colours and dark text so it
// stays legible wherever it is pasted (unlike screen captures on HDR/wide-gamut
// displays, which can blow out the light blues).

const INK = "#1a1a19", INK2 = "#4b4b47", INK3 = "#6b6b66", RULE = "#e2e2dd", SURFACE = "#fcfcfb";
const ACCENT = "#eb6834", HIGHLIGHT = "#eef4fc";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD = 16;
const PANEL_W = 300;

// Copy the WebGL canvas during a render, while its drawing buffer is still valid,
// so the map doesn't need preserveDrawingBuffer (a constant performance cost).
function grabMap(map) {
  return new Promise((resolve) => {
    map.once("render", () => {
      const src = map.getCanvas();
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      c.getContext("2d").drawImage(src, 0, 0);
      resolve(c);
    });
    map.triggerRepaint();
  });
}

function font(ctx, size, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

// Draw wrapped text; returns the y below the last line.
function wrap(ctx, text, x, y, maxW, lineH) {
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function drawLegend(ctx, legend, x, bottom) {
  const lineH = 20, w = 230;
  const h = 12 + 34 + legend.items.length * lineH + 30;
  const y = bottom - h;
  roundRect(ctx, x, y, w, h, 8, "rgba(252,252,251,0.96)", RULE);
  let cy = y + 22;
  ctx.fillStyle = INK;
  font(ctx, 13, 650);
  cy = wrap(ctx, legend.title, x + 12, cy, w - 24, 16) + 4;
  font(ctx, 12.5);
  for (const it of legend.items) {
    if (it.hatch) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 12, cy - 10, 18, 12);
      ctx.clip();
      ctx.fillStyle = "#e4e4e0";
      ctx.fillRect(x + 12, cy - 10, 18, 12);
      ctx.strokeStyle = "#9a9a95";
      ctx.lineWidth = 1.5;
      for (let o = -12; o < 24; o += 5) { ctx.moveTo(x + 12 + o, cy + 2); ctx.lineTo(x + 24 + o, cy - 10); }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = it.color;
      ctx.fillRect(x + 12, cy - 10, 18, 12);
    }
    ctx.fillStyle = INK2;
    ctx.fillText(it.label, x + 38, cy);
    cy += lineH;
  }
  ctx.fillStyle = INK;
  font(ctx, 12.5, 600);
  ctx.fillText(legend.footer, x + 12, cy + 6);
}

function drawPanel(ctx, d, x, y, w) {
  let cy = y + PAD + 6;
  const inner = w - PAD * 2;
  if (d.note) {
    font(ctx, 12);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(x + PAD, cy - 13, 3, 18);
    ctx.fillStyle = INK2;
    cy = wrap(ctx, d.note, x + PAD + 10, cy, inner - 10, 16) + 8;
  }
  ctx.fillStyle = INK;
  font(ctx, 17, 700);
  ctx.fillText(d.heading, x + PAD, cy + 4);
  cy += 26;
  font(ctx, 13);
  ctx.fillStyle = INK2;
  cy = wrap(ctx, d.sub, x + PAD, cy, inner, 17) + 8;

  // table
  font(ctx, 11.5, 600);
  ctx.fillStyle = INK3;
  ctx.textAlign = "right";
  ctx.fillText("Median", x + w - PAD - 74, cy);
  ctx.fillText("Percentile", x + w - PAD, cy);
  ctx.textAlign = "left";
  cy += 8;
  for (const r of d.rows) {
    const rowH = 26;
    if (r.selected) { ctx.fillStyle = HIGHLIGHT; ctx.fillRect(x + PAD - 4, cy, inner + 8, rowH); }
    font(ctx, 13, r.selected ? 700 : 400);
    ctx.fillStyle = r.selected ? INK : INK2;
    ctx.fillText(r.label, x + PAD, cy + 17);
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    ctx.fillText(r.value, x + w - PAD - 74, cy + 17);
    ctx.fillText(r.pct, x + w - PAD, cy + 17);
    ctx.textAlign = "left";
    cy += rowH;
    ctx.fillStyle = RULE;
    ctx.fillRect(x + PAD, cy, inner, 1);
  }
  cy += 22;
  font(ctx, 13);
  for (const line of d.lines) {
    ctx.fillStyle = line.note ? INK2 : INK;
    cy = wrap(ctx, line.text, x + PAD, cy, inner, 18) + 4;
  }
  font(ctx, 11.5);
  ctx.fillStyle = INK3;
  for (const f of d.fine) cy = wrap(ctx, f, x + PAD, cy + 4, inner, 15);
}

/**
 * opts: { map, title, subtitle, legend: {title, items:[{color|hatch,label}], footer},
 *         details?: {note, heading, sub, rows:[{label,value,pct,selected}], lines:[{text}], fine:[]},
 *         pin?: [lng, lat], credits: [string], url }
 * Resolves to a PNG Blob.
 */
export async function snapshot(opts) {
  const { map } = opts;
  const mapImg = await grabMap(map);
  const dpr = mapImg.width / map.getCanvas().clientWidth;
  const mapW = map.getCanvas().clientWidth, mapH = map.getCanvas().clientHeight;
  const panelW = opts.details ? PANEL_W : 0;
  const headH = 58;

  // Measure the footer height before allocating the canvas.
  const probe = document.createElement("canvas").getContext("2d");
  font(probe, 11);
  const footW = mapW + panelW - PAD * 2;
  let footLines = 0;
  for (const c of opts.credits) {
    let line = "";
    for (const word of c.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (probe.measureText(t).width > footW && line) { footLines++; line = word; } else line = t;
    }
    footLines++;
  }
  const footH = PAD + footLines * 15 + 8;

  const W = mapW + panelW, H = headH + mapH + footH;
  const out = document.createElement("canvas");
  out.width = Math.round(W * dpr);
  out.height = Math.round(H * dpr);
  const ctx = out.getContext("2d", { colorSpace: "srgb" });
  ctx.scale(dpr, dpr);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = INK;
  font(ctx, 18, 700);
  ctx.fillText(opts.title, PAD, 26);
  font(ctx, 13);
  ctx.fillStyle = INK2;
  ctx.fillText(opts.subtitle, PAD, 46);
  ctx.textAlign = "right";
  ctx.fillStyle = INK3;
  ctx.fillText(opts.url, W - PAD, 26);
  ctx.textAlign = "left";
  ctx.fillStyle = RULE;
  ctx.fillRect(0, headH - 1, W, 1);

  // map + overlays
  ctx.drawImage(mapImg, 0, headH, mapW, mapH);
  if (opts.pin) {
    const p = map.project(opts.pin);
    ctx.beginPath();
    ctx.arc(p.x, headH + p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
  drawLegend(ctx, opts.legend, PAD, headH + mapH - PAD);

  if (opts.details) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(mapW, headH, panelW, mapH);
    ctx.fillStyle = RULE;
    ctx.fillRect(mapW, headH, 1, mapH);
    drawPanel(ctx, opts.details, mapW, headH, panelW);
  }

  // footer
  ctx.fillStyle = RULE;
  ctx.fillRect(0, headH + mapH, W, 1);
  font(ctx, 11);
  ctx.fillStyle = INK3;
  let fy = headH + mapH + PAD + 4;
  for (const c of opts.credits) fy = wrap(ctx, c, PAD, fy, footW, 15);

  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))), "image/png"));
}
