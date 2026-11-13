// "Which neighbourhood is this address in?" A small search box for the neighbourhood pages,
// for readers who know their address but not the City's name for their neighbourhood.
//
// It reuses the census map's address lookup (search.js over search.json: official City
// addresses and intersections to 2021 census dissemination areas) and the 2021 figures file
// (each DA's neighbourhood, and for the 13 DAs that straddle a boundary, the other one).
// Both load on first use, so the page itself stays light (about 1.2 MB compressed, once).
//
//   addressFinder(host, { nbhd, onPick, go })
//     host    the element to fill
//     nbhd    the page's neighbourhoods, [{id, name}], in the page's order
//     onPick  called with a neighbourhood's index in nbhd when the reader picks one
//     go      the action the result offers, e.g. "Explore it" (default "Show it")
import { escapeHTML } from "./catalogue.js";

let loading = null;
function load() {
  return (loading ??= Promise.all([
    import("./search.js"),
    fetch(`/search.json?v=${__SEARCH_VERSION__}`).then((r) => {
      if (!r.ok) throw new Error(`search.json: HTTP ${r.status}`);
      return r.json();
    }),
    fetch(`/data/figures/2021/common.json?v=${__FIGURES_VERSION__}`).then((r) => {
      if (!r.ok) throw new Error(`common.json: HTTP ${r.status}`);
      return r.json();
    }),
  ]).then(([{ SearchIndex }, doc, common]) => {
    const da = new Map(common.dauid.map((u, k) => [String(u), { id: common.nbhd_id[k], name: common.nbhd[k], also: common.nbhd2[k] }]));
    return { index: new SearchIndex(doc), da };
  }).catch((e) => {
    loading = null; // let the next try start again
    throw e;
  }));
}

// a name and the punctuation after it stay on one line
const nw = (html, after) => `<span class="addr-nw">${html}${after}</span>`;
// "A, B, C and D", then `end`
const list = (names, end) => {
  const head = names.slice(0, -1);
  const last = nw(names.at(-1), end);
  return head.length ? `${head.map((n, k) => (k < head.length - 1 ? nw(n, ",") : n)).join(" ")} and ${last}` : last;
};

export function addressFinder(host, { nbhd, onPick, go = "Show it" }) {
  const byId = new Map(nbhd.map((n, i) => [n.id, i])), byName = new Map(nbhd.map((n, i) => [n.name, i]));
  const uid = `addr-q-${Math.random().toString(36).slice(2, 8)}`;
  host.classList.add("addr-find");
  host.innerHTML = `<form role="search" autocomplete="off">
      <label for="${uid}" class="visually-hidden">Find a neighbourhood by address</label>
      <input id="${uid}" type="search" placeholder="Find a neighbourhood by address" enterkeyhint="search" spellcheck="false" />
      <button type="submit">Find</button>
    </form>
    <p class="addr-out" aria-live="polite" hidden></p>`;
  const form = host.querySelector("form"), input = host.querySelector("input"), out = host.querySelector(".addr-out");
  const say = (html) => { out.innerHTML = html; out.hidden = !html; };
  const name = (i) => `<button type="button" class="addr-nb" data-i="${i}" title="${escapeHTML(go)}">${escapeHTML(nbhd[i].name)}</button>`;

  // A result's DAs, as the page's neighbourhoods: [{i, also}] (also: the second neighbourhood
  // of a DA that straddles a boundary), each neighbourhood once.
  function places(L, das) {
    const seen = new Map();
    for (const k of das) {
      const d = L.da.get(String(L.index.das[k][0]));
      const i = d && byId.get(d.id);
      if (i == null) continue;
      const also = d.also != null ? byName.get(d.also) : null;
      if (!seen.has(i)) seen.set(i, { i, also: also ?? null });
    }
    return [...seen.values()];
  }

  function sentence(L, r) {
    const label = `<b>${escapeHTML(r.label)}</b>${r.detail ? ` (${escapeHTML(r.detail)})` : ""}`;
    const p = places(L, r.das);
    if (!p.length) return `${label} couldn't be placed in a neighbourhood. Try a street address.`;
    if (p.length === 1 && p[0].also == null) return `${label} is in ${nw(name(p[0].i), ".")}`;
    if (p.length === 1) return `${label} is on a block that is mostly in ${name(p[0].i)} and partly in ${nw(name(p[0].also), ".")}`;
    return `${label} is on the edge of ${list(p.map((x) => name(x.i)), ".")}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return say("");
    say(`<span class="addr-wait">Looking it up…</span>`);
    let L;
    try {
      L = await load();
    } catch {
      return say("The address list didn't load. Check the connection and try again.");
    }
    const res = L.index.resolve(q);
    // the lookup's messages are written for the map page
    if (res.status === "error") return say(`${escapeHTML(res.message.replace("This map covers", "This site covers"))}${res.hint ? ` <span class="addr-hint">${escapeHTML(res.hint)}</span>` : ""}`);
    const lines = res.results.slice(0, 5).map((r) => sentence(L, r));
    const more = res.results.length - lines.length + (res.more ?? 0);
    say(lines.join("<br>") + (more > 0 ? ` <span class="addr-hint">and ${more} more: add the area (e.g. "Scarborough") to narrow it.</span>` : ""));
  });
  input.addEventListener("focus", () => { load().catch(() => {}); }, { once: true }); // start loading early
  input.addEventListener("input", () => { if (!input.value.trim()) say(""); });
  out.addEventListener("click", (e) => {
    const b = e.target.closest(".addr-nb");
    if (b) onPick(+b.dataset.i);
  });
}
