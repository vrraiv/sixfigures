// Shared by the pages (main.js, y2011.js): the tile protocol, the measure
// catalogue, colours, formatting, the legend patterns and the histogram.
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// Vector tiles are static files unpacked from the .pmtiles archives at build time
// (scripts/extract-tiles.mjs), so the browser fetches only the tiles in view. They
// are stored gzipped; this protocol inflates them unless the server or browser
// already has. A missing tile (404, or the dev server's index.html) is empty.
maplibregl.setWorkerUrl(workerUrl);
maplibregl.addProtocol("gztile", async ({ url }, abort) => {
  const resp = await fetch(url.replace("gztile://", `${location.origin}/`), { signal: abort.signal });
  if (resp.status === 404 || (resp.headers.get("content-type") ?? "").startsWith("text/html")) return { data: new ArrayBuffer(0) };
  if (!resp.ok) throw new Error(`Tile request failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { data: buf };
  return { data: await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() };
});
export const tileSource = (t) => ({ type: "vector", tiles: [`gztile://${t.tiles}`], minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds });
export const TILES = __TILES__;

// The street map under the census colours: the Protomaps basemap cut for Toronto
// (pipeline/basemap.py), served from this site like every other tile, with its layers
// (scripts/basemap-style.mjs) and label fonts (web/public/fonts). Built when the page loads
// because MapLibre wants the glyph address in full.
export const STYLE = {
  version: 8,
  glyphs: `${location.origin}/fonts/{fontstack}/{range}.pbf`,
  sources: {
    protomaps: { ...tileSource(TILES.base), attribution: '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  },
  layers: __BASEMAP_LAYERS__,
};
export const BOUNDS = [[-79.6393, 43.5792], [-79.1153, 43.8555]];

// The map's opening view, for a map element of the size it has now. Toronto is wider than
// it is tall, so on a wide screen the whole city fits the box with room to spare at the
// sides. On a narrow one (a phone, a tablet held upright) fitting the whole width would
// leave the city a thin strip with empty bands above and below, so the view fills the box's
// height instead, up to one zoom level closer, and the east and west ends are a pan away.
// The pages' inline preloaders (census/index.html, 2011/index.html) work out the same view.
const mercY = (lat) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const latOf = (y) => ((Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - Math.PI / 4) * 360) / Math.PI;
export function openingCamera(el, bounds = BOUNDS, pad = 24) {
  const [[w, s], [e, n]] = bounds;
  if (!el.clientWidth || !el.clientHeight) return { bounds, fitBoundsOptions: { padding: pad } };
  const zw = Math.log2((el.clientWidth - 2 * pad) / (((e - w) / 360) * 512));
  const zh = Math.log2((el.clientHeight - 2 * pad) / ((mercY(s) - mercY(n)) * 512));
  return { center: [(w + e) / 2, latOf((mercY(s) + mercY(n)) / 2)], zoom: zw < zh ? Math.min(zh, zw + 1) : zh };
}

export * from "./catalogue.js";
import { escapeHTML, fmtCount } from "./catalogue.js";

export function pattern(kind) {
  const size = 16, c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = kind === "dots" ? "#f7f7f5" : "#e4e4e0";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = ctx.strokeStyle = "#9a9a95";
  if (kind === "dots") {
    for (const [x, y] of [[4, 4], [12, 12]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 45° lines, drawn across tile edges so the pattern tiles seamlessly
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const o of [-size, 0, size]) {
      ctx.moveTo(o, size);
      ctx.lineTo(o + size, 0);
    }
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

export function distHTML(d) {
  const { lo, width, counts } = d.hist;
  const n = counts.length, max = Math.max(...counts);
  const bin = Math.min(Math.max(Math.floor((d.value - lo) / width), 0), n - 1);
  const W = 300, H = 44, bw = W / n;
  const bars = counts.map((c, i) => {
    const h = c ? Math.max((c / max) * H, 1) : 0;
    return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}"${i === bin ? ' class="here"' : ""}/>`;
  }).join("");
  const rx = ((d.ref - lo) / (width * n)) * W;
  const ref = rx >= 0 && rx <= W ? `<line x1="${rx.toFixed(1)}" x2="${rx.toFixed(1)}" y1="0" y2="${H}" class="ref"/>` : "";
  const hi = lo + width * n;
  const label = `Histogram. This DA is in the ${d.fmt(lo + bin * width)} to ${d.fmt(lo + (bin + 1) * width)} bin, with ${fmtCount(counts[bin])} DAs.`;
  return `<figure class="dist">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(label)}">${bars}${ref}</svg>
      <div class="dist-axis"><span>${lo === 0 && d.zero ? d.zero : `${d.fmt(lo)} or less`}</span><span>${hi >= (d.max ?? Infinity) ? d.fmt(hi) : `${d.fmt(hi)} or more`}</span></div>
      <figcaption>${escapeHTML(d.caption)}</figcaption>
    </figure>`;
}
