// Unpack the .pmtiles archives into static z/x/y tile files under web/public/tiles.
//
// Cloudflare's static-asset cache answers Range requests with the whole file, so
// serving the archives directly makes every visitor download all of
// toronto_da.pmtiles before the map draws. As separate files, the browser fetches
// only the tiles in view (about 0.5 MB for the whole city at zoom 10).
//
// Tiles are written gzipped and decompressed in the browser (main.js), so it
// doesn't matter whether a server labels them Content-Encoding: gzip or not.
// Each archive goes in a directory named after its content hash, so the files
// can be cached as immutable (web/public/_headers). Runs from vite.config.js;
// an archive whose directory already exists is skipped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { PMTiles } from "pmtiles";

const OUT = "web/public/tiles";

class BufferSource {
  constructor(key, buf) {
    this.key = key;
    this.buf = buf;
  }
  getKey() {
    return this.key;
  }
  async getBytes(offset, length) {
    const b = this.buf.subarray(offset, offset + length);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  }
}

const tileRange = (lon, lat, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(Math.max(x, 0), n - 1), Math.min(Math.max(y, 0), n - 1)];
};

// Returns what MapLibre needs for a vector source: the tile URL template (relative
// to the site root), zoom range, bounds and layer names. null if the file is missing.
export async function extractTiles(file, name) {
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  const version = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const archive = new PMTiles(new BufferSource(file, buf));
  const h = await archive.getHeader();
  const meta = await archive.getMetadata();
  const dir = `${name}-${version}`;
  mkdirSync(OUT, { recursive: true });
  for (const d of readdirSync(OUT)) if (d.startsWith(`${name}-`) && d !== dir) rmSync(join(OUT, d), { recursive: true });
  if (!existsSync(join(OUT, dir))) {
    let count = 0;
    // The header bounds are the data's; tiles that only hold a feature's buffer can
    // sit just outside them, hence the one-tile margin (checked below).
    for (let z = h.minZoom; z <= h.maxZoom; z++) {
      const n = 2 ** z;
      const [x0, y0] = tileRange(h.minLon, h.maxLat, z);
      const [x1, y1] = tileRange(h.maxLon, h.minLat, z);
      for (let x = Math.max(x0 - 1, 0); x <= Math.min(x1 + 1, n - 1); x++) {
        for (let y = Math.max(y0 - 1, 0); y <= Math.min(y1 + 1, n - 1); y++) {
          const t = await archive.getZxy(z, x, y);
          if (!t) continue;
          mkdirSync(join(OUT, `${dir}.tmp`, `${z}`, `${x}`), { recursive: true });
          writeFileSync(join(OUT, `${dir}.tmp`, `${z}`, `${x}`, `${y}.pbf`), gzipSync(Buffer.from(t.data), { level: 9 }));
          count++;
        }
      }
    }
    if (count !== h.numAddressedTiles) throw new Error(`${file}: unpacked ${count} of ${h.numAddressedTiles} tiles`);
    // Written under .tmp and renamed, so an interrupted run is redone next time.
    rmSync(join(OUT, dir), { recursive: true, force: true });
    if (count) renameSync(join(OUT, `${dir}.tmp`), join(OUT, dir));
    console.log(`${file}: ${count} tiles -> ${OUT}/${dir}`);
  }
  return {
    tiles: `tiles/${dir}/{z}/{x}/{y}.pbf`,
    minzoom: h.minZoom,
    maxzoom: h.maxZoom,
    bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
    layers: (meta?.vector_layers ?? []).map((l) => l.id),
  };
}
