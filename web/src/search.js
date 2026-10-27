// Offline address / intersection -> DA lookup over web/public/search.json
// (built by pipeline/search_index.py from City of Toronto Open Data).
// Only exact official addresses resolve; nothing is guessed or interpolated.

// Street-type and direction words, mapped to the City's abbreviations. Applied
// to both the query and the official names, so "Park Lawn Rd" stays consistent.
const WORDS = {
  street: "st", str: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", dri: "dr",
  crescent: "cres", cr: "cres", boulevard: "blvd", blv: "blvd", court: "crt", ct: "crt",
  trail: "trl", square: "sq", place: "pl", circle: "crcl", cir: "crcl", terrace: "ter",
  terr: "ter", gardens: "gdns", gdn: "gdns", parkway: "pkwy", pky: "pkwy", gate: "gt",
  pathway: "ptwy", heights: "hts", circuit: "crct", park: "pk", woods: "wds", green: "grn",
  lawn: "lwn", roadway: "rdwy", grove: "grv", expressway: "expy", highway: "hwy",
  west: "w", east: "e", north: "n", south: "s",
};
const DIRS = new Set(["w", "e", "n", "s"]);

// City of Toronto's six former municipalities (as named in the address data)
// and neighbouring municipalities that must not match Toronto streets.
const FORMER = {
  "former toronto": "former Toronto", "old toronto": "former Toronto",
  scarborough: "Scarborough", "north york": "North York", etobicoke: "Etobicoke",
  york: "York", "east york": "East York",
};
const TORONTO = new Set(["toronto", "city of toronto", "on", "ont", "ontario", "canada"]);
const OUTSIDE = [
  "mississauga", "brampton", "markham", "vaughan", "richmond hill", "pickering", "ajax",
  "whitby", "oshawa", "oakville", "burlington", "milton", "hamilton", "caledon", "king city",
  "aurora", "newmarket", "stouffville", "whitchurch-stouffville", "uxbridge", "concord",
  "woodbridge", "thornhill", "maple", "unionville", "georgina", "east gwillimbury",
  "halton hills", "georgetown", "bolton", "durham", "york region", "peel",
];
const POSTAL = /\b[a-z]\d[a-z]\s?\d[a-z]\d\b/;

export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9&/@#-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(" ");
}

// Every way a street may be typed: full, without type, without direction, bare.
function forms(name) {
  const t = normalize(name).split(" ");
  const out = new Set([t.join(" ")]);
  const dir = t.length > 1 && DIRS.has(t.at(-1)) ? t.at(-1) : null;
  const core = dir ? t.slice(0, -1) : t;
  if (dir) out.add(core.join(" "));
  if (core.length > 1) {
    const base = core.slice(0, -1);
    out.add(base.join(" "));
    if (dir) out.add([...base, dir].join(" "));
  }
  return out;
}

function unrle(s) {
  const out = [];
  for (const run of s.split(";")) {
    const [v, n = "1"] = run.split("*");
    for (let i = 0; i < +n; i++) out.push(+v);
  }
  return out;
}

const numberKey = (tok) => parseInt(tok, 10);

export class SearchIndex {
  constructor(doc) {
    this.das = doc.das;
    this.y2016 = doc.y2016 ?? { das: [], links: {} };
    this.munis = doc.munis;
    this.streets = doc.streets.map(([name, nums, da, mu]) => ({ name, nums, da, mu }));
    this.allNames = [...this.streets.map((s) => s.name), ...doc.names];
    this.byForm = new Map();
    this.byFull = new Map(); // exact full name, preferred over shortened forms
    this.allNames.forEach((name, id) => {
      const full = normalize(name);
      if (!this.byFull.has(full)) this.byFull.set(full, []);
      this.byFull.get(full).push(id);
      for (const f of forms(name)) {
        if (!this.byForm.has(f)) this.byForm.set(f, []);
        this.byForm.get(f).push(id);
      }
    });
    this.formKeys = [...this.byForm.keys()].sort();
    this.byStreet = new Map(); // street id -> intersections containing it
    this.x = doc.x.map(([ids, x, y, das], i) => {
      const e = { ids: ids.split(".").map(Number), lng: x / 1e5, lat: y / 1e5, das: das.split(".").map(Number) };
      for (const id of e.ids) {
        if (!this.byStreet.has(id)) this.byStreet.set(id, []);
        this.byStreet.get(id).push(i);
      }
      return e;
    });
  }

  da(i) {
    const [dauid, w, s, e, n, x, y] = this.das[i];
    return { dauid, bbox: [w, s, e, n], point: [x, y] };
  }

  daByUid(uid) {
    const i = this.das.findIndex((d) => d[0] === uid);
    return i < 0 ? null : this.da(i);
  }

  /**
   * The 2016 DA(s) for a set of 2021 DA indices, via the official
   * correspondence: unchanged DAs keep their DAUID (same land), a split 2021 DA
   * maps to the one 2016 DA containing it, a redrawn one to every 2016 DA it
   * overlaps. Returns { das: [{dauid, bbox, point}], redrawn } where redrawn
   * means a boundary changed and the user should pick.
   */
  in2016(indices) {
    const y = this.y2016;
    const out = new Map();
    let redrawn = false;
    for (const i of indices) {
      const link = y.links[i];
      if (!link) {
        const d = this.da(i);
        out.set(d.dauid, d);
        continue;
      }
      const [flag, targets] = link;
      if (flag !== 3) redrawn = true;
      for (const t of targets) {
        const [dauid, w, s, e, n, x, yy] = y.das[t];
        out.set(dauid, { dauid, bbox: [w, s, e, n], point: [x, yy] });
      }
    }
    return { das: [...out.values()], redrawn };
  }

  expand(st) {
    if (!st.rows) {
      const nums = st.nums.split(","), da = unrle(st.da), mu = unrle(st.mu);
      st.rows = nums.map((n, i) => ({ num: n, key: n.toLowerCase(), da: da[i], muni: this.munis[mu[i]] ?? null }));
    }
    return st.rows;
  }

  // ---------------------------------------------------------------- parsing

  /**
   * Split off place context. Returns { variants, muni, outside?, trailingOutside? }.
   * variants are query readings to try in order: the text as typed first, then
   * with trailing "Toronto ON Canada" words removed. A street may legitimately end
   * in such a word, or in a neighbouring municipality's name (Markham Rd typed as
   * "20 Markham"), so those readings are only fallbacks, never applied blindly.
   */
  parseContext(raw) {
    const q = raw.toLowerCase().replace(POSTAL, " ").trim();
    const segs = q.split(",").map((s) => s.trim()).filter(Boolean);
    let muni = null;
    const first = segs.shift() ?? "";
    const keep = [];
    for (const seg of segs) {
      // After a comma everything is place context: "Toronto ON", "Scarborough, ON".
      const words = seg.replace(/[.]/g, " ").split(/\s+/).filter(Boolean);
      const noProv = words.filter((w) => !["on", "ont", "ontario", "canada"].includes(w)).join(" ");
      if (FORMER[noProv]) { muni = FORMER[noProv]; continue; } // "former Toronto", "Scarborough ON"
      const s = words.filter((w) => !TORONTO.has(w) && w !== "city" && w !== "of").join(" ");
      if (!s) continue;
      if (OUTSIDE.includes(s)) return { outside: seg };
      keep.push(seg);
    }
    const literal = [first, ...keep].join(" ").trim();
    let stripped = literal.replace(/[.]/g, " ").trim();
    for (let prev = ""; prev !== stripped;) {
      prev = stripped;
      stripped = stripped.replace(/\s+(city of toronto|toronto|ontario|ont|on|canada)$/, "").trim();
    }
    const trailingOutside = OUTSIDE.find((o) => stripped.endsWith(" " + o));
    return { variants: [...new Set([literal, stripped])], muni, trailingOutside };
  }

  // Unit designators: "Unit 5", "Apt 5", "Suite 5", "#5".
  static stripUnit(q) {
    return q
      .replace(/\b(unit|apt|apartment|suite|ste)\b\.?\s*#?\s*[a-z0-9-]+/g, " ")
      .replace(/#\s*[a-z0-9-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  streetIds(text, { addressOnly = false } = {}) {
    const key = normalize(text);
    const ids = this.byFull.get(key) ?? this.byForm.get(key) ?? [];
    return addressOnly ? ids.filter((id) => id < this.streets.length) : ids;
  }

  // ----------------------------------------------------------------- search

  /**
   * Resolve free text. Returns one of:
   *   { status: "match", kind, results: [hit] }       go straight to it
   *   { status: "choose", kind, results: [hit, ...] } let the user pick
   *   { status: "error", message, hint? }
   * hit = { label, das: [i, ...], point? }
   */
  resolve(raw) {
    const text = raw.trim();
    if (!text) return { status: "error", message: "Type a Toronto street address or an intersection." };
    const uid = text.replace(/^da\s*/i, "");
    if (/^3520\d{4}$/.test(uid)) {
      const i = this.das.findIndex((d) => d[0] === uid);
      if (i >= 0) return { status: "match", kind: "da", results: [{ label: `DA ${uid}`, das: [i] }] };
      return { status: "error", message: `DA ${uid} is not a City of Toronto dissemination area.` };
    }
    const ctx = this.parseContext(text);
    const outside = (o) => ({ status: "error", message: `That looks like an address in ${title(o)}. This map covers the City of Toronto only.` });
    if (ctx.outside) return outside(ctx.outside);
    let res;
    for (const v of ctx.variants) {
      res = this.resolveQuery(SearchIndex.stripUnit(v), ctx.muni);
      if (res.status !== "error") return res;
    }
    // "100 City Centre Dr Mississauga": only refused once no Toronto reading exists.
    return ctx.trailingOutside ? outside(ctx.trailingOutside) : res;
  }

  resolveQuery(q, muni) {
    if (/\s(&|and|at|@)\s|[&/@]/.test(q) && !/^\d/.test(q)) return this.intersection(q);
    if (/^\d/.test(q)) return this.address(q, muni);
    const ids = this.streetIds(q);
    if (ids.length) {
      return { status: "error", message: `Add a house number, e.g. "100 ${this.allNames[ids[0]]}", or a cross street, e.g. "${this.allNames[ids[0]]} & …".` };
    }
    return { status: "error", message: "Enter a street address (e.g. 100 Queen St W) or an intersection (e.g. Yonge & Bloor)." };
  }

  address(q, muni) {
    // Official number forms: 12, 12A, 12 1/2, 11-19, 12A-14A, 5A-7.
    const m = q.match(/^(\d+[a-z]?(?:-\d+[a-z]?)?(?:\s+\d\/\d)?)(?:\s+([a-z])\b)?\s+(.+)$/);
    if (!m) return { status: "error", message: "Couldn't read a house number and street from that." };
    const [, numPart, letter, rest] = m;
    // Try the most literal reading first, then weaker ones:
    //  "17 c Main St" -> 17C Main St, then 17 "C Main St"
    //  "1203-100 Queen" -> official range "1203-100", then unit 1203 at 100
    const tries = [];
    if (letter) tries.push([numPart + letter, rest], [numPart, `${letter} ${rest}`]);
    else tries.push([numPart, rest]);
    if (numPart.includes("-")) {
      const civic = numPart.split("-").at(-1);
      tries.push(...tries.map(([n, s]) => [n.replace(numPart, civic), s]));
    }
    let streetHit = null;
    for (const [num, street] of tries) {
      const ids = this.streetIds(street, { addressOnly: true });
      if (!ids.length) continue;
      streetHit ??= { ids, num };
      const hits = [];
      for (const id of ids) {
        const st = this.streets[id];
        for (const r of this.expand(st)) {
          if (r.key === num && (!muni || r.muni === muni)) hits.push({ st, r });
        }
      }
      if (hits.length) return this.addressHits(hits);
    }
    if (!streetHit) {
      return { status: "error", message: `No street called "${title(rest)}" in the City of Toronto address list. Check the spelling, or try the street type (St, Ave, Rd…).` };
    }
    const names = [...new Set(streetHit.ids.map((id) => this.streets[id].name))];
    const near = this.nearestNumbers(streetHit.ids, streetHit.num, muni);
    return {
      status: "error",
      message: `${streetHit.num.toUpperCase()} isn't an official address on ${names.slice(0, 3).join(" / ")}${muni ? ` in ${muni}` : ""}.`,
      hint: near.length ? `Nearest listed numbers: ${near.join(", ")}` : undefined,
    };
  }

  addressHits(hits) {
    // Group records by street + number + municipality; keep every DA.
    const groups = new Map();
    for (const { st, r } of hits) {
      const k = `${r.num} ${st.name}|${r.muni}`;
      if (!groups.has(k)) groups.set(k, { label: `${r.num} ${st.name}`, muni: r.muni, das: [] });
      groups.get(k).das.push(r.da);
    }
    const results = [...groups.values()];
    const sameLabel = new Set(results.map((g) => g.label)).size < results.length;
    for (const g of results) if (sameLabel || results.length > 1) g.detail = g.muni ?? "";
    return { status: results.length === 1 ? "match" : "choose", kind: "address", results };
  }

  nearestNumbers(ids, num, muni) {
    const target = numberKey(num);
    const all = ids.flatMap((id) => this.expand(this.streets[id]))
      .filter((r) => !muni || r.muni === muni)
      .map((r) => r.num);
    return [...new Set(all)]
      .sort((a, b) => Math.abs(numberKey(a) - target) - Math.abs(numberKey(b) - target) || numberKey(a) - numberKey(b))
      .slice(0, 4)
      .sort((a, b) => numberKey(a) - numberKey(b));
  }

  intersection(q) {
    const parts = q.split(/\s+(?:and|at)\s+|\s*[&/@]\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return { status: "error", message: "For an intersection, name two streets, e.g. Yonge & Bloor." };
    const sets = parts.map((p) => new Set(this.streetIds(p)));
    const bad = parts.filter((_, i) => !sets[i].size);
    if (bad.length) {
      return { status: "error", message: `No street called "${title(bad[0])}" in the City of Toronto street list.` };
    }
    const seed = [...sets[0]].flatMap((id) => this.byStreet.get(id) ?? []);
    const found = [...new Set(seed)].filter((i) => sets.every((s) => this.x[i].ids.some((id) => s.has(id))));
    if (!found.length) {
      return { status: "error", message: `${parts.map(title).join(" and ")} don't meet in the City's intersection list.` };
    }
    const results = found.slice(0, 12).map((i) => {
      const e = this.x[i];
      return { label: e.ids.map((id) => this.allNames[id]).join(" / "), das: e.das, point: [e.lng, e.lat] };
    });
    return { status: results.length === 1 ? "match" : "choose", kind: "intersection", results, more: found.length - results.length };
  }

  // Typeahead: official addresses whose street starts with what was typed.
  suggest(raw, limit = 8) {
    const ctx = this.parseContext(raw);
    if (ctx.outside) return [];
    for (const v of ctx.variants) {
      const out = this.suggestFor(SearchIndex.stripUnit(v), ctx.muni, limit);
      if (out.length) return out;
    }
    return [];
  }

  suggestFor(q, muni, limit) {
    const m = q.match(/^(\d+[a-z]?(?:-\d+[a-z]?)?(?:\s+\d\/\d)?)\s+(.{2,})$/);
    if (!m) return [];
    const [, num, prefix] = m;
    const p = normalize(prefix);
    const out = [];
    const seen = new Set();
    // formKeys is sorted, so matches for a prefix are contiguous.
    let lo = 0, hi = this.formKeys.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.formKeys[mid] < p) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < this.formKeys.length && this.formKeys[i].startsWith(p) && out.length < limit; i++) {
      for (const id of this.byForm.get(this.formKeys[i])) {
        if (id >= this.streets.length || seen.has(id)) continue;
        seen.add(id);
        const st = this.streets[id];
        for (const r of this.expand(st)) {
          const key = `${r.num} ${st.name}|${r.muni}`;
          if (r.key === num && (!muni || r.muni === muni) && !seen.has(key)) {
            seen.add(key);
            out.push({ text: `${r.num} ${st.name}${muni ? ", " + muni : ""}`, label: `${r.num} ${st.name}`, detail: r.muni });
          }
        }
        if (out.length >= limit) break;
      }
    }
    // Same address in several former municipalities: say which is which.
    const counts = out.reduce((c, s) => c.set(s.label, (c.get(s.label) ?? 0) + 1), new Map());
    for (const s of out) if (counts.get(s.label) > 1) s.text = `${s.label}, ${s.detail}`;
    return out;
  }
}

function title(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
