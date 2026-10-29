// The DA figures, loaded apart from the tiles: one small JSON file per measure
// and census under data/figures/<year>/ (pipeline/figures.py). The tiles carry
// only DA numbers; main.js colours them through feature state from these.
//
// common.json: { dauid: [...], nbhd: [...], nbhd_id, nbhd2, pop21|pop16, hh, rel }
// <measure>.json: { v: [...], pct: [...] } plus v16 and p16 for 2021
// Every array lists DAs in common.json's order.

const VERSION = typeof __FIGURES_VERSION__ === "string" ? __FIGURES_VERSION__ : "dev";

export class Figures {
  constructor(year, fetchJSON = defaultFetch) {
    this.year = year;
    this.fetchJSON = fetchJSON;
    this.pending = new Map(); // name -> promise
    this.files = {}; // name -> parsed file, once loaded
    this.index = null; // dauid -> row
  }

  url(name) {
    return `/data/figures/${this.year}/${name}.json?v=${VERSION}`;
  }

  // Loads a file once; a failed load is retried on the next call.
  file(name) {
    let p = this.pending.get(name);
    if (!p) {
      p = this.fetchJSON(this.url(name)).then((data) => {
        this.files[name] = data;
        if (name === "common") this.index = new Map(data.dauid.map((id, i) => [id, i]));
        return data;
      }, (err) => {
        this.pending.delete(name);
        throw err;
      });
      this.pending.set(name, p);
    }
    return p;
  }

  // Resolves once common.json and the named measures' files are loaded.
  load(...measures) {
    return Promise.all(["common", ...measures].map((n) => this.file(n))).then(() => this);
  }

  has(...measures) {
    return !!this.files.common && measures.every((m) => this.files[m]);
  }

  get dauids() {
    return this.files.common?.dauid ?? [];
  }

  // The figures of one DA as a flat object, with the given (loaded) measures'
  // columns as m, pct_m and, for 2021, v16_m and p16_m. null for an unknown DA.
  props(dauid, measures = []) {
    const i = this.index?.get(dauid);
    if (i == null) return null;
    const c = this.files.common;
    const p = { dauid };
    for (const k in c) if (k !== "dauid") p[k] = c[k][i];
    for (const m of measures) {
      const f = this.files[m];
      if (!f) continue;
      p[m] = f.v[i];
      p[`pct_${m}`] = f.pct[i];
      if (f.v16) {
        p[`v16_${m}`] = f.v16[i];
        p[`p16_${m}`] = f.p16[i];
      }
    }
    return p;
  }
}

// The class a value falls in: how many stops it reaches (MapLibre's step).
export const classIndex = (value, stops) => stops.filter((s) => value >= s).length;

async function defaultFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
