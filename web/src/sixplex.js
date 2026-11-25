// The Sixplex zoning experiment: what the June 2025 by-law (six homes on a lot in eight wards,
// four in the rest) has done to the homes proposed, from sixplex.json (pipeline/sixplex_insights.py,
// whose docstring is the design). Every figure in the text is read from that file: the page
// refreshes with the permits, so nothing here states a number of its own.
import "./style.css";
import { $, COLORS, escapeHTML, loadFailed, loadJSON } from "./catalogue.js";
import { chart, initTip, key } from "./charts.js";
import { buildToc } from "./nbtools.js";

const D = await loadJSON(`/sixplex.json?v=${__SIXPLEX_VERSION__}`).catch(loadFailed);
const LIGHT = COLORS[1], BLUE = COLORS[3], DARK = COLORS[5], ORANGE = "#c2410c", GREY = "#dcdcd6";
const Q = D.quarters, [P0, P1] = D.pre, [A0, A1] = D.post;
const M = D.main, arms = D.arms;
const six = D.wards.filter((w) => w.arm === "six"), four = D.wards.filter((w) => w.arm === "four"), early = D.wards.find((w) => w.arm === "early");
const nPre = P1 - P0 + 1, nPost = A1 - A0 + 1;

// ---- words and numbers ----------------------------------------------------------------------------------------
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
const word = (n) => WORDS[n] ?? String(n);
const fmtN = (v) => (v == null ? "—" : (Math.round(v) + 0).toLocaleString("en-CA")); // + 0: no "-0"
const signed = (v) => (v == null ? "—" : `${Math.round(v) < 0 ? "−" : Math.round(v) > 0 ? "+" : ""}${Math.abs(Math.round(v)).toLocaleString("en-CA")}`);
const fmtX = (r) => (r == null ? "—" : `×${r.toFixed(2)}`);
// "12% more" / "9% fewer", from a ratio
const more = (r) => `${Math.round(Math.abs(r - 1) * 100)}% ${r >= 1 ? "more" : "fewer"}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const qStart = (q) => `${MONTHS[(+q.at(-1) - 1) * 3]} ${q.slice(0, 4)}`, qEnd = (q) => `${MONTHS[+q.at(-1) * 3 - 1]} ${q.slice(0, 4)}`;
const day = (iso) => `${+iso.slice(8)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const before = `${qStart(Q[P0])} to ${qEnd(Q[P1])}`, after = `${qStart(Q[A0])} to ${qEnd(Q[A1])}`;
const total = (vs, a, b) => vs.slice(a, b + 1).reduce((s, v) => s + v, 0);
const check = (k) => D.checks.find((c) => c.key === k), placebo = (k) => D.placebos.find((c) => c.key === k);
// projects of five or six homes, by the quarter they reached that size; `filed` counts those
// since refused or withdrawn too, as the Housing page does
const bigBy = { six: arms.big_projects.six, four: arms.big_projects.four };
const big = { sixPre: total(bigBy.six, P0, P1), sixPost: total(bigBy.six, A0, A1), fourPost: total(bigBy.four, A0, A1),
  filed: total(arms.filed_big_projects.six, A0, A1) + total(arms.filed_big_projects.early, A0, A1) };
// which way the estimate points: the range's side of "no effect"
const verdict = M.lo > 1 ? "more" : M.hi < 1 ? "fewer" : "unclear";
const trend = check("trend");

initTip();

// ---- the question: the wards, by rule -----------------------------------------------------------------------------
function renderMap() {
  const fill = (w) => (w.arm === "six" ? BLUE : w.arm === "early" ? "url(#sx-hatch)" : GREY);
  const rule = (w) => (w.arm === "six" ? `Six homes from ${day(D.bylaw.six)}` : w.arm === "early" ? `Six homes from ${day(D.bylaw.early)}, under its own by-law` : "Four homes");
  const tip = (w) => `<b>${w.name}</b> (ward ${+w.ward})<br>${rule(w)}<br>Homes proposed in multiplex projects, a quarter: <b>${(w.pre / nPre).toFixed(1)}</b> before, <b>${(w.post / nPost).toFixed(1)}</b> after<br>Projects of five or six homes since the by-law: <b>${w.big_post}</b>`;
  $("ward-map").innerHTML = `<svg viewBox="0 0 ${D.map.width} ${D.map.height}" role="img" aria-label="Toronto's 25 wards: the eight where six homes are allowed, Ward 23, and the sixteen left at four, each with its projects of five or six homes proposed since the by-law">
    <defs><pattern id="sx-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${GREY}"/><line x1="0" y1="0" x2="0" y2="8" stroke="${BLUE}" stroke-width="3"/></pattern></defs>
    <g>${D.wards.map((w) => `<path d="${w.path}" fill="${fill(w)}" data-tip="${escapeHTML(tip(w))}"/>`).join("")}</g>
    <g class="sx-n" aria-hidden="true">${D.wards.map((w) => `<text x="${w.at[0]}" y="${w.at[1]}" class="${w.arm === "six" ? "on" : ""}">${w.big_post}</text>`).join("")}</g></svg>`;
  $("map-key").innerHTML = `<li><span class="key-sq" style="background:${BLUE}"></span>Six homes allowed from June 2025 (${word(six.length)} wards)</li>`
    + `<li><span class="key-sq" style="background:${GREY}"></span>Four homes (${word(four.length)} wards)</li>`
    + (early ? `<li><span class="key-sq" style="background:repeating-linear-gradient(45deg, ${GREY} 0 3px, ${BLUE} 3px 5px)"></span>${escapeHTML(early.name)}: six from February 2025</li>` : "");
  $("map-note").textContent = `The number in each ward: projects of five or six homes proposed from ${after}. Hover or tap a ward for its figures.`;
  $("q-note").innerHTML = early ? `One ward sits outside the comparison. ${escapeHTML(early.name)} (ward ${+early.ward}) got six homes under its own by-law on ${day(D.bylaw.early)}, months before the others, so it belongs with neither group. `
    + `It has had ${early.big_post === 0 ? "no project of five or six homes" : `${word(early.big_post)} project${early.big_post > 1 ? "s" : ""} of five or six homes`} since.` : "";
}

// ---- the short answer ---------------------------------------------------------------------------------------------
function renderAnswer() {
  const head = {
    unclear: "Sixplexes arrived. Whether the city got more homes because of them can't be told yet.",
    more: "Sixplexes arrived, and the eight wards pulled ahead of the rest of the city.",
    fewer: "Sixplexes arrived, but the eight wards fell behind the rest of the city.",
  }[verdict];
  const reading = {
    unclear: `The difference is ${signed(M.extra)} homes, and differences that size turn up between groups of wards for no reason at all: the range runs from ${signed(M.extra_lo)} to ${signed(M.extra_hi)}.`,
    more: `The difference is ${signed(M.extra)} homes, more than differences between groups of wards usually produce: the range runs from ${signed(M.extra_lo)} to ${signed(M.extra_hi)}.`,
    fewer: `The difference is ${signed(M.extra)} homes, with a range from ${signed(M.extra_lo)} to ${signed(M.extra_hi)}.`,
  }[verdict];
  const where = trend.extra > M.extra_hi ? "above that range" : trend.extra < M.extra_lo ? "below that range" : "inside that range";
  const catching = trend.slope < 0;
  $("answer").innerHTML = `<p class="sx-head">${head}</p>
    <p>Builders proposed <b>${fmtN(big.sixPost)} projects of five or six homes</b> in the eight wards in the ${nPost * 3} months after the by-law (${after}). In the two years before, there ${big.sixPre === 1 ? "was one" : `were ${word(big.sixPre)}`}.</p>
    <p>What matters, though, is every multiplex project, large and small, since a sixplex may only replace a fourplex that would have been built anyway. On that count the eight wards saw <b>${fmtN(M.t1)} homes</b> proposed. Had they grown at the pace of the other sixteen wards, they would have seen about <b>${fmtN(M.expected)}</b>. ${reading}</p>
    <p>That comparison may also be the wrong one. Before the by-law the two groups of wards were not moving together: the rest of the city was ${catching ? "gaining on" : "losing ground to"} the eight wards quarter after quarter. A check added after the first results carries that trend forward, and puts the difference at ${signed(trend.extra)} homes, ${where}. The data can't say which reading is right.</p>
    <p><b>So: the estimate fixed in advance runs from ${signed(M.extra_lo)} to ${signed(M.extra_hi)} homes${verdict === "unclear" ? ", which includes no effect at all" : ""}, and a reasonable check chosen afterwards says ${signed(trend.extra)}.</b> All of it is ${nPost * 3} months of applications, not homes built.</p>`;
  const card = (name, v, note) => `<div class="card static"><span class="card-name">${name}</span><span class="card-value">${v}</span><span class="card-delta">${note}</span></div>`;
  $("cards").innerHTML = [
    card("Projects of five or six homes", fmtN(big.sixPost), `in the eight wards since the by-law; ${fmtN(big.fourPost)} elsewhere`),
    card("Homes proposed, eight wards", fmtN(M.t1), `in multiplex projects, ${after}`),
    card("At the rest of the city's pace", fmtN(M.expected), "what the eight wards would have seen"),
    card("The estimate", signed(M.extra), `homes; range ${signed(M.extra_lo)} to ${signed(M.extra_hi)}`),
    card("If the earlier trend had held", signed(trend.extra), "homes; a check added later"),
  ].join("");
}

// ---- sixplexes arrived --------------------------------------------------------------------------------------------
const from = Q.indexOf("2022 Q1") < 0 ? 0 : Q.indexOf("2022 Q1");
const cut = (vs) => vs.slice(from);
const marks = [{ at: A0 - from, label: "By-law" }];
function renderCame() {
  $("came-lede").innerHTML = `A building of five or six homes isn't allowed under the four-home rule, so it is the clearest trace of the new one. `
    + `In the two years before the by-law the eight wards saw ${fmtN(big.sixPre)}, each needing special permission. They have seen ${fmtN(big.sixPost)} since, adding ${fmtN(total(arms.big_homes.six, A0, A1))} homes. `
    + `The other sixteen wards had ${fmtN(big.fourPost)}. Their permits point to other routes: a minor variance, the rules for apartment buildings on major streets, or the legalizing of homes that already existed.`;
  $("came-fig").innerHTML = `<h3 class="sub-h">Projects of five or six homes proposed, by quarter</h3>`
    + chart({ labels: cut(Q), bars: [{ name: "The eight sixplex wards", color: BLUE, values: cut(bigBy.six) }, { name: "The other sixteen wards", color: ORANGE, values: cut(bigBy.four) }], fmt: fmtN, marks })
    + key([["The eight sixplex wards", BLUE], ["The other sixteen wards", ORANGE]])
    + `<figcaption>Building permit applications for houseplexes of five or six homes, by the quarter the project reached that size. Applications since refused or withdrawn are left out. The <a href="/insights/housing/">Housing page</a> counts those too, and Ward 23 with the eight: ${fmtN(big.filed)} over the same quarters.</figcaption>`;
}

// ---- more homes? ---------------------------------------------------------------------------------------------------
function renderHomes() {
  const smallSix = [total(arms.small_homes.six, P0, P1) / nPre, total(arms.small_homes.six, A0, A1) / nPost];
  const smallFour = [total(arms.small_homes.four, P0, P1) / nPre, total(arms.small_homes.four, A0, A1) / nPost];
  const allSix = [M.t0 / nPre, M.t1 / nPost], allFour = [M.c0 / nPre, M.c1 / nPost];
  const size = (a, p0, p1) => total(arms.plex_homes[a], p0, p1) / total(arms.plex_projects[a], p0, p1);
  const change = (v) => { const r = v[1] / v[0]; return Math.abs(r - 1) < 0.1 ? "about level" : `${r > 1 ? "up" : "down"} ${Math.round(Math.abs(r - 1) * 100)}%`; };
  $("homes-lede").innerHTML = `A sixplex adds homes only if it is built where nothing, or something smaller, would have been. If builders are putting up sixplexes in place of the fourplexes they would have built anyway, the gain is two homes a lot, not six. `
    + `So the count that matters is every home in every multiplex project: two, three, four, five or six homes at a time.`;
  const panel = (title, a, line) => `<figure class="panel"><h3 class="sub-h">${title}</h3>`
    + chart({ labels: cut(Q), bars: [{ name: "In projects of up to four homes", color: LIGHT, values: cut(arms.small_homes[a]) }, { name: "In projects of five or six", color: DARK, values: cut(arms.big_homes[a]) }],
      lines: line ? [{ name: "At the other wards' pace", color: ORANGE, dash: true, values: cut(D.expected.map((v, k) => (k >= A0 ? v : null))) }] : [], fmt: fmtN, marks, height: 200 })
    + key([["Projects of up to four homes", LIGHT], ["Projects of five or six", DARK], ...(line ? [["At the other wards' pace", ORANGE, "line"]] : [])]) + `</figure>`;
  $("homes-figs").innerHTML = panel("The eight sixplex wards: homes proposed, by quarter", "six", true) + panel("The other sixteen wards", "four", false);
  $("homes-after").innerHTML = `In the eight wards, homes in smaller projects went from ${fmtN(smallSix[0])} a quarter before the by-law to ${fmtN(smallSix[1])} after (${change(smallSix)}), and projects of five or six homes added ${fmtN(total(arms.big_homes.six, A0, A1) / nPost)} a quarter on top. `
    + `All together: ${fmtN(allSix[0])} homes a quarter before, ${fmtN(allSix[1])} after, ${change(allSix)}. `
    + `Over the same months the other sixteen wards, with no new rule, went from ${fmtN(allFour[0])} to ${fmtN(allFour[1])}, ${change(allFour)}, with ${Math.round((1 - total(arms.big_homes.four, A0, A1) / M.c1) * 100)}% of their homes after the by-law in projects of up to four (${change(smallFour)}). `
    + `The average project in the eight wards grew from ${size("six", P0, P1).toFixed(1)} homes to ${size("six", A0, A1).toFixed(1)}. `
    + `The dashed line is the comparison this page was built to make: the eight wards' homes if they had kept their earlier share of the two groups' total.`;
}

// ---- the estimate --------------------------------------------------------------------------------------------------
function renderEstimate() {
  const pct = Math.round(M.p * 100);
  $("est").innerHTML = `<p>The method is a <b>difference in differences</b>, the standard way to read an experiment nobody designed. The rest of the city stands in for what the eight wards would have done without the by-law.</p>
    <ol class="sx-steps">
      <li><b>Before</b> (${before}, the two years when four homes were allowed everywhere): ${fmtN(M.t0)} homes proposed in the eight wards, ${fmtN(M.c0)} in the other sixteen.</li>
      <li><b>After</b> (${after}): ${fmtN(M.t1)} in the eight, ${fmtN(M.c1)} in the sixteen.</li>
      <li><b>The comparison.</b> The sixteen wards' count after was ${(M.c1 / M.c0).toFixed(2)} times their count before (${nPost} quarters against ${nPre}: the ratio allows for the periods' different lengths). At that pace the eight wards would have had ${fmtN(M.t0)} × ${(M.c1 / M.c0).toFixed(2)} = about ${fmtN(M.expected)} homes.</li>
      <li><b>The estimate.</b> They had ${fmtN(M.t1)}: ${signed(M.extra)} homes, or ${more(M.ratio)} than expected.</li>
    </ol>
    <p><b>The range.</b> Wards differ from one another for all sorts of reasons, so some gap would appear with no by-law at all. To see how much, the same sum was run for every possible way of calling ${word(six.length)} of the ${six.length + four.length} wards "the sixplex wards": ${D.assignments.toLocaleString("en-CA")} of them. `
    + `${pct >= 1 ? `In ${pct}% of those made-up groupings` : "In fewer than 1% of those made-up groupings"}, the gap was at least as large as the real one. `
    + `The range, ${signed(M.extra_lo)} to ${signed(M.extra_hi)} homes (${more(M.lo)} to ${more(M.hi)}), holds every effect that this test can't rule out at the ${Math.round(D.level * 100)}% level.</p>
    <p>${verdict === "unclear" ? "A range that spans zero means the data is consistent with the by-law having added homes, having added none, and having cost some. It does not mean the by-law did nothing." : "A range clear of zero says the eight wards are unusual among groups of wards. It does not prove the by-law is why."}</p>`;
}

// ---- why to doubt it -----------------------------------------------------------------------------------------------
function renderDoubt() {
  const s = placebo("suites"), h = placebo("houses"), y = placebo("yearearly");
  const fails = (c) => c.p != null && c.p < 0.1, doubtful = (c) => c.p != null && c.p < 0.25;
  const off = [y, s, h].filter(doubtful);
  $("doubt-lede").innerHTML = `The comparison rests on one assumption: without the by-law, the two groups of wards would have kept moving together. That can be checked for the two years before, and it doesn't hold well. `
    + `The chart shows the eight wards' homes against the other sixteen's, with 1 as their average standing before the by-law. If the groups had been moving together the line would be flat up to the by-law. `
    + `Instead it ${trend.slope < 0 ? "falls" : "rises"} about ${Math.abs(trend.slope).toFixed(0)}% a quarter${trend.slope < 0 ? ". A likely reason: multiplexes were new to the suburbs in 2023 and long familiar downtown, and the suburbs were catching up" : ""}.`;
  $("doubt-fig").innerHTML = `<h3 class="sub-h">The eight wards against the other sixteen (1 = their average standing before the by-law)</h3>`
    + chart({ labels: Q.slice(P0), lines: [{ name: "Eight wards against sixteen", color: DARK, values: D.relative.slice(P0) }], fmt: (v) => v.toFixed(2), zero: false, marks: [{ at: A0 - P0, label: "By-law" }], height: 190 })
    + `<figcaption>Homes proposed in multiplex projects in the eight wards, divided by those in the sixteen, each quarter, over the same ratio for all of ${before}.</figcaption>`;
  const row = (name, c, want) => `<tr><th>${name}</th><td>${fmtX(c.ratio)}</td><td>${c.p == null ? "—" : `${Math.round(c.p * 100)}%`}</td><td class="txt">${fails(c) ? `Fails: a gap where there ${want}` : doubtful(c) ? "Doubtful: a gap this large is uncommon" : "Passes"}</td></tr>`;
  $("doubt-after").innerHTML = `<p>Three placebo tests ask the method for an effect where there shouldn't be one. A sound comparison returns about ×1.00 each time.</p>
    <div class="tbl-wrap"><table class="tbl fc-wrap"><thead><tr><th class="txt">Placebo</th><th>Estimate</th><th>Groupings with a gap this large</th><th class="txt">Result</th></tr></thead><tbody>
    ${row("A by-law imagined a year early (the two years before, split in half)", y, "was no by-law")}
    ${row("Laneway and garden suites, which the by-law didn't touch", s, "was no change of rule")}
    ${row("New detached houses, which it didn't touch either", h, "was no change of rule")}
    </tbody></table></div>
    <p>${off.length === 0 ? "The placebos pass, which supports the comparison without proving it."
    : off.every((c) => c.ratio < 1) && trend.slope < 0 ? `Where a placebo fails or is doubtful, it leans the same way as the chart: the rest of the city gaining on the eight wards with no by-law to explain it. If that was still going on after June 2025, the estimate above understates what the by-law did, because it holds the eight wards to a pace they were already falling short of.`
    : `Where a placebo fails or is doubtful, the comparison finds a gap with no by-law to explain it, and the estimate above inherits that fault.`}
    One way to allow for the trend is to carry it forward: on that reading the eight wards would have been expected to see about ${fmtN(trend.expected)} homes, and saw ${fmtN(trend.t1)}, a difference of ${signed(trend.extra)}. But that check was added after the first results were in, and it assumes the earlier drift would have gone on at the same rate, which nobody can know. A trend drawn through ${nPre} quarters is a thin thing to extend.</p>`;
}

// ---- the same question, other ways ------------------------------------------------------------------------------------
const CHECKS = {
  ward23: () => `${early ? escapeHTML(early.name) : "Ward 23"} counted with the eight`,
  borders: () => `Against only the ${word(four.filter((w) => w.borders).length)} wards that border the eight`,
  matched: () => `Each of the eight against its ${word(D.k)} most similar wards`,
  filed: () => "Counting applications since refused or withdrawn",
  issued: () => "Only permits issued so far",
  new: () => "New buildings only, not conversions",
  building: () => "The building's homes, not the homes added",
  projects: () => "Projects, not homes",
  oneyear: () => "One year before, not two",
  additive: () => "Homes per ward, not growth rates",
  trend: () => "The earlier trend carried forward †",
};
function renderChecks() {
  const lr = D.leave.map((l) => l.ratio);
  const rows = [{ name: "The estimate", ratio: M.ratio, lo: M.lo, hi: M.hi, extra: M.extra, main: true },
    ...D.checks.map((c) => ({ name: CHECKS[c.key](), ratio: c.ratio, extra: c.extra, unit: c.key === "projects" ? " projects" : "" })),
    { name: "Leaving out any one ward", lo: Math.min(...lr), hi: Math.max(...lr), span: true }];
  const all = rows.flatMap((r) => [r.ratio, r.lo, r.hi]).filter((v) => v != null);
  const lo = Math.log(Math.min(0.5, ...all) * 0.92), hi = Math.log(Math.max(2, ...all) * 1.08);
  const x = (r) => (((Math.log(r) - lo) / (hi - lo)) * 100).toFixed(2);
  const ticks = [0.5, 0.67, 1, 1.5, 2, 3].filter((t) => Math.log(t) > lo && Math.log(t) < hi);
  $("checks-lede").innerHTML = `Every choice in the method could reasonably have been made another way. Each row below changes one of them and leaves the rest. The blue bar is the estimate's range. `
    + `A dot right of the line says the eight wards got more homes than the comparison expected, and left says fewer.`;
  $("checks").innerHTML = `<ol class="sx-checks">${rows.map((r) => {
    const tip = r.span ? `${r.name}<br>From <b>${fmtX(r.lo)}</b> to <b>${fmtX(r.hi)}</b>` : `${r.name}<br><b>${fmtX(r.ratio)}</b> of what was expected (${more(r.ratio)})<br>${signed(r.extra)}${r.unit || " homes"}${r.main ? `<br>Range ${fmtX(r.lo)} to ${fmtX(r.hi)}` : ""}`;
    return `<li${r.main ? ' class="main"' : ""}><span class="sx-name">${r.name}</span>
      <span class="sx-track" data-tip="${escapeHTML(tip)}"><span class="sx-one" style="left:${x(1)}%"></span>${r.lo != null ? `<span class="sx-range${r.span ? " span" : ""}" style="left:${x(r.lo)}%;width:${(x(r.hi) - x(r.lo)).toFixed(2)}%"></span>` : ""}${r.ratio != null ? `<span class="sx-dot" style="left:${x(r.ratio)}%"></span>` : ""}</span>
      <span class="sx-val">${r.span ? `${fmtX(r.lo)} to ${fmtX(r.hi)}` : `${signed(r.extra)}${r.unit ?? ""}`}</span></li>`;
  }).join("")}
    <li class="sx-axis" aria-hidden="true"><span class="sx-name"></span><span class="sx-track">${ticks.map((t) => `<span style="left:${x(t)}%">${t === 1 ? "no effect" : `×${t}`}</span>`).join("")}</span><span class="sx-val"></span></li></ol>`;
  const near = D.checks.filter((c) => !c.late && c.ratio != null), inside = near.filter((c) => c.ratio >= M.lo && c.ratio <= M.hi).length;
  $("checks-note").innerHTML = `The figure at the right is the difference in homes (the scale is the ratio to what was expected: ×1.5 is half as many again). ${inside === near.length ? `All ${word(near.length)}` : `${inside} of the ${near.length}`} checks not marked † fall inside the estimate's range. `
    + `† Added after the first results were seen. "Similar" wards are the nearest on how many homes were proposed before the by-law and how fast that was growing.`;
}

// ---- ward by ward ------------------------------------------------------------------------------------------------------
function renderWards() {
  const order = { six: 0, four: 1, early: 2 };
  const rows = [...D.wards].sort((a, b) => order[a.arm] - order[b.arm] || b.post - a.post);
  const rule = { six: "Six", four: "Four", early: "Six, from Feb 2025" };
  $("wards-lede").innerHTML = `Homes proposed in multiplex projects, as a rate per quarter so that the two periods compare, and the projects of five or six homes since the by-law. No one ward makes the result: without any single ward the estimate stays between ${fmtX(Math.min(...D.leave.map((l) => l.ratio)))} and ${fmtX(Math.max(...D.leave.map((l) => l.ratio)))}.`;
  $("wards").innerHTML = `<thead><tr><th class="txt">Ward</th><th class="txt">Homes allowed</th><th>Homes a quarter, before</th><th>After</th><th>Change</th><th>Projects of five or six, after</th></tr></thead><tbody>${rows.map((w) => {
    const a = w.pre / nPre, b = w.post / nPost;
    return `<tr${w.arm === "six" ? ' class="sel"' : ""}><th>${escapeHTML(w.name)} <span class="small">${+w.ward}</span></th><td class="txt">${rule[w.arm]}</td><td>${a.toFixed(1)}</td><td>${b.toFixed(1)}</td><td>${w.pre >= 8 ? `${b >= a ? "+" : "−"}${Math.round(Math.abs(b / a - 1) * 100)}%` : "—"}</td><td>${w.big_post}</td></tr>`;
  }).join("")}</tbody>
    <caption>Before: ${before}. After: ${after}. A change isn't given where a ward had fewer than eight homes proposed before.</caption>`;
}

// ---- what this can't show, and how it was done ------------------------------------------------------------------------
function renderCant() {
  $("cant").innerHTML = [
    `<b>Whether homes get built.</b> These are permit applications. Some will be refused or withdrawn, some approved and never built, and a multiplex takes a year or more to finish. The first sixplexes proposed under the by-law are mostly not yet lived in.`,
    `<b>The long run.</b> The by-law is ${nPost * 3} months old in this data. Builders needed time to design for it, and an early rush or a slow start would both mislead.`,
    `<b>What the eight wards would have done.</b> They weren't picked at random. They are the old city: smaller lots, older houses, more transit, dearer land and a longer history of duplexes and triplexes. The rest of the city is the best stand-in available, and the section above shows it is a poor one.`,
    `<b>The zoning alone.</b> In July 2025 Council also waived development charges and parkland levies on multiplexes of up to six homes. The estimate is of everything that changed for these projects that summer, together.`,
    `<b>Where builders would otherwise have gone.</b> If the by-law drew small builders from the suburbs into the eight wards, the gap overstates what the city gained. Owners outside the eight wards also got five or six homes by other routes (${fmtN(big.fourPost)} projects), which narrows the gap between the groups.`,
    `<b>How many homes a project really adds.</b> A project's homes are the dwelling units its permit says it creates. ${fmtN(D.counted["projects on the list with no homes created on a permit"])} projects on the list state none and add nothing here, and the City's counts are not audited. Counting each building's full size, which includes homes already there, gives a lower estimate (in the checks above).`,
    `<b>Anything about who lives there.</b> Nothing here bears on rents, prices, who can afford the homes, what was demolished, trees, parking or what neighbours think.`,
    `<b>What Council should do.</b> A number of homes proposed is one input to a decision about zoning, and this one is uncertain.`,
  ].map((t) => `<li>${t}</li>`).join("");
}

function renderHow() {

  $("how").innerHTML = `<ul>
    <li><b>The data.</b> The City of Toronto's building permit files, retrieved ${day(D.retrieved)}, to the end of ${MONTHS[+D.last_month.slice(5) - 1]} ${D.last_month.slice(0, 4)}. Only whole quarters are used, so the latest is ${Q[A1]}.</li>
    <li><b>A multiplex project</b> is one on the <a href="/insights/housing/">Housing page</a>'s list: an application that builds, or converts a building into, a houseplex of three to six homes, its size read from the permit's proposed use or description. ${fmtN(D.counted["projects counted"])} projects since 2021 add homes here. Applications since refused, withdrawn or cancelled are left out of the estimate and counted in a check.</li>
    <li><b>Its homes</b> are the dwelling units created on its building permit: the homes added, not the building's size, so a duplex made into a fourplex is two.</li>
    <li><b>Which wards have six.</b> From the City's multiplex housing page, read ${day(D.fixed)}: the Toronto and East York district and Ward 23. If another ward opts in, it has to leave the comparison group, and this page will need redoing.</li>
    <li><b>Homes are dated by when they were proposed.</b> The files keep each revision of a permit. A fourplex applied for in 2024 and revised to six homes in 2026 counts as four homes in 2024 and two in 2026. ${fmtN(D.counted["projects whose homes changed with a revision"])} projects' homes changed with a revision.</li>
    <li><b>Wards.</b> Each project is in the ward its permit names. The eight are wards ${six.map((w) => +w.ward).join(", ").replace(/, (\d+)$/, " and $1")}.</li>
    <li><b>Before and after.</b> Before runs from the first whole quarter after four homes were allowed everywhere (${day(D.bylaw.four)}) to ${qEnd(Q[P1])}, so the by-law's last five days of June 2025 count as before. After runs from ${qStart(Q[A0])}.</li>
    <li><b>The estimate</b> is a ratio: the eight wards' homes after over before, divided by the same for the sixteen. Ratios, because the two groups differ in size and the counts are small.</li>
    <li><b>The range</b> comes from a permutation test over all ${D.assignments.toLocaleString("en-CA")} ways of choosing ${word(six.length)} wards of ${six.length + four.length}. It treats the wards as interchangeable, which they are not, so it measures how unusual the eight are among groups of wards and not the chance of an error in a designed trial.</li>
    <li><b>Fixed in advance, mostly.</b> The outcome, the wards, the periods, the estimate, the checks and the placebos were written down on ${day(D.fixed)}, before any estimate was computed, but after rough counts of permits by size and half-year had been looked at for each group of wards. The trend check (†) was added after the first results.</li>
    <li><b>Rebuilt once, after the first results.</b> The first version counted projects its own way: permits of the City's "3+ Unit" types, placed by address, with a project of "five or six" one that added that many homes. On ${day(D.rebuilt)} it was rebuilt on the Housing page's list so that the two pages count the same projects. The outcome, wards, periods, estimate and range stayed as fixed. The estimate moved from ${signed(D.before_rebuild.extra)} homes (range ${signed(D.before_rebuild.extra_lo)} to ${signed(D.before_rebuild.extra_hi)}) to ${signed(M.extra)} (${signed(M.extra_lo)} to ${signed(M.extra_hi)}). Two checks changed with it: "a wider definition" became "new buildings only", and "the building's homes" was added.</li>
    <li><b>It will move.</b> The page is rebuilt when the permit files are refreshed, each quarter adding to "after". Later revisions, refusals and withdrawals change earlier quarters too.</li>
  </ul>
  <p>The code is <a href="https://github.com/vrraiv/sixfigures/blob/main/pipeline/sixplex.py"><code>pipeline/sixplex.py</code></a> (the counts) and <a href="https://github.com/vrraiv/sixfigures/blob/main/pipeline/sixplex_insights.py"><code>pipeline/sixplex_insights.py</code></a> (the estimates), and the table of homes by ward and month is <a href="https://github.com/vrraiv/sixfigures/tree/main/pipeline/sixplex">in the repository</a>.</p>`;
}

renderMap();
renderAnswer();
renderCame();
renderHomes();
renderEstimate();
renderDoubt();
renderChecks();
renderWards();
renderCant();
renderHow();
buildToc();
