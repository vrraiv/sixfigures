// The Sixplex zoning experiment: what the June 2025 by-law (six homes on a lot in eight wards,
// four in the rest) has done to the homes proposed, from sixplex.json (pipeline/sixplex_insights.py,
// whose docstring is the design). Every figure in the text is read from that file: the page
// refreshes with the permits, so nothing here states a number of its own.
import "./style.css";
import { $, COLORS, escapeHTML, loadFailed, loadJSON } from "./catalogue.js";
import { chart, initTip, key } from "./charts.js";
import { buildToc } from "./nbtools.js";

const D = await loadJSON(`/sixplex.json?v=${__SIXPLEX_VERSION__}`).catch(loadFailed);
const LIGHT = COLORS[1], BLUE = COLORS[3], DARK = COLORS[5], ORANGE = "#c2410c", GREY = "#dcdcd6", MUTED = "#8a8a84";
const Q = D.quarters, [P0, P1] = D.pre, [A0, A1] = D.post;
// H: the headline (the trend before the by-law carried on, fading); F: the same with the catch-up
// stopping at the by-law and never slowing; M: the estimate fixed in advance (the groups' averages)
const H = D.headline, F = D.fades, M = D.main, arms = D.arms;
const six = D.wards.filter((w) => w.arm === "six"), four = D.wards.filter((w) => w.arm === "four"), early = D.wards.find((w) => w.arm === "early");
const nPre = P1 - P0 + 1, nPost = A1 - A0 + 1;

// ---- words and numbers ----------------------------------------------------------------------------------------
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
const word = (n) => WORDS[n] ?? String(n);
const fmtN = (v) => (v == null ? "—" : (Math.round(v) + 0).toLocaleString("en-CA")); // + 0: no "-0"
const signed = (v) => (v == null ? "—" : `${Math.round(v) < 0 ? "−" : Math.round(v) > 0 ? "+" : ""}${Math.abs(Math.round(v)).toLocaleString("en-CA")}`);
const fmtX = (r) => (r == null ? "—" : `×${r.toFixed(2)}`);
// a round figure for a sentence: 252 -> "250"
const about = (v) => fmtN(Math.round(Math.abs(v) / 10) * 10);
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
const verdict = H.lo > 1 ? "more" : H.hi < 1 ? "fewer" : "unclear";
const catching = H.slope < 0; // the other wards were gaining on the eight before the by-law
const halfLife = D.half_life % 4 === 0 ? `${D.half_life === 4 ? "year" : `${word(D.half_life / 4)} years`}` : `${word(D.half_life)} quarters`;

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
  $("map-note").innerHTML = `The number in each ward: buildings of five or six homes proposed from ${after}. Hover or tap a ward for its figures.`
    + (early ? ` ${escapeHTML(early.name)} got six homes under its own by-law in February 2025, months before the others, so it is left out of the comparison.` : "");
}

// ---- the short answer ---------------------------------------------------------------------------------------------
const pane = { labels: () => cut(Q), bars: (a) => [{ name: "In buildings of up to four homes", color: LIGHT, values: cut(arms.small_homes[a]) }, { name: "In buildings of five or six", color: DARK, values: cut(arms.big_homes[a]) }] };
function renderAnswer() {
  const gain = H.extra > 0, share = Math.round((Math.abs(H.extra) / H.t1) * 100);
  const head = verdict === "more" ? `Yes: about ${about(H.extra)} more homes have been proposed than without it.`
    : verdict === "fewer" ? `No: about ${about(H.extra)} fewer homes have been proposed than without it.`
    : gain ? `Our best estimate is about ${about(H.extra)} more homes proposed so far. It is too early to be sure there are any.`
    : "So far there is no sign that it has added homes, though it is too early to be sure.";
  const unsure = verdict === "unclear"
    ? `That figure is uncertain. The true number could plausibly be anywhere from ${H.extra_lo < 0 ? `a small loss` : `about ${fmtN(H.extra_lo)}`} to nearly ${fmtN(Math.ceil(H.extra_hi / 50) * 50)}, so no gain at all can't be ruled out.`
    : `The true number could plausibly be anywhere from about ${fmtN(H.extra_lo)} to about ${fmtN(H.extra_hi)}.`;
  $("answer").innerHTML = `<p class="sx-head">${head}</p>
    <p>In June 2025 Toronto began allowing six homes on a house lot in eight downtown wards. Everywhere else the limit stayed at four. A month later City Council also waived development charges on these buildings. The two changes came too close together to tell apart, so what follows is the effect of both.</p>
    <p>Builders responded right away. In the ${nPost * 3} months since, they have applied to build <b>${fmtN(big.sixPost)} buildings of five or six homes</b> in those wards, against ${fmtN(big.sixPre)} in the two years before.</p>
    <p>Some of those would have been built anyway as fourplexes. So this page counts every home in every small multi-unit building (a "multiplex"), and asks how many the eight wards would have seen without the new rule. They saw ${fmtN(H.t1)}. We estimate they were heading for about ${about(H.expected)}. The difference, <b>about ${about(H.extra)} ${gain ? "extra" : "fewer"} homes</b>, is what we credit to the two changes.</p>
    <p>${unsure} And these are applications to build, not finished homes.</p>`;
  const card = (name, v, note) => `<div class="card static"><span class="card-name">${name}</span><span class="card-value">${v}</span><span class="card-delta">${note}</span></div>`;
  $("cards").innerHTML = [
    card("Buildings of five or six homes proposed", fmtN(big.sixPost), `in the eight wards since June 2025, up from ${fmtN(big.sixPre)} in the two years before`),
    card(`${gain ? "Extra" : "Fewer"} homes: best estimate`, signed(H.extra), `about ${share}% of the ${fmtN(H.t1)} homes proposed there`),
    card("It could plausibly be", `${signed(H.extra_lo)} to ${signed(H.extra_hi)}`, verdict === "unclear" ? "none at all can't be ruled out" : "homes"),
  ].join("");
  $("answer-fig").innerHTML = `<h3 class="sub-h">Homes proposed in multiplexes in the eight wards, every three months</h3>`
    + chart({ labels: pane.labels(), bars: pane.bars("six"), lines: [{ name: "Where they were heading without the new rule", color: ORANGE, dash: true, values: cut(D.expected_fading) }], fmt: fmtN, marks, height: 220 })
    + key([["In buildings of up to four homes", LIGHT], ["In buildings of five or six", DARK], ["Where the eight wards were heading without the new rule (our estimate)", ORANGE, "line"]])
    + `<figcaption>Each bar is three months of applications. The dark part is homes in buildings of five or six, which the new rule allows. The bars standing above the dashed line are the extra homes.</figcaption>`;
}

// ---- sixplexes arrived --------------------------------------------------------------------------------------------
const from = Q.indexOf("2022 Q1") < 0 ? 0 : Q.indexOf("2022 Q1");
const cut = (vs) => vs.slice(from);
const marks = [{ at: A0 - from, label: "New rule" }];
function renderCame() {
  $("came-lede").innerHTML = `A building of five or six homes isn't allowed under the four-home rule, so it is the clearest sign of the new one. `
    + `In the two years before June 2025 the eight wards saw ${fmtN(big.sixPre)} proposed, each needing special permission. They have seen ${fmtN(big.sixPost)} since. `
    + `The rest of the city had ${fmtN(big.fourPost)}, by special permission or under other rules.`;
  $("came-fig").innerHTML = `<h3 class="sub-h">Buildings of five or six homes proposed, every three months</h3>`
    + chart({ labels: cut(Q), bars: [{ name: "The eight wards where six are allowed", color: BLUE, values: cut(bigBy.six) }, { name: "The rest of the city", color: ORANGE, values: cut(bigBy.four) }], fmt: fmtN, marks })
    + key([["The eight wards where six are allowed", BLUE], ["The rest of the city", ORANGE]])
    + `<figcaption>Applications since refused or withdrawn are left out. The <a href="/insights/housing/">Housing page</a> counts those too: ${fmtN(big.filed)} over the same months.</figcaption>`;
}

// ---- more homes? ---------------------------------------------------------------------------------------------------
function renderHomes() {
  const allSix = [M.t0 / nPre, M.t1 / nPost], allFour = [M.c0 / nPre, M.c1 / nPost];
  const up = (v) => { const r = v[1] / v[0]; return Math.abs(r - 1) < 0.05 ? "about the same" : `${r > 1 ? "up" : "down"} ${Math.round(Math.abs(r - 1) * 100)}%`; };
  $("homes-lede").innerHTML = `<p>A sixplex only adds homes if it goes up where nothing, or something smaller, would have. If builders are putting up sixplexes in place of the fourplexes they had planned anyway, the gain is two homes a lot, not six. So the fair count is every home in every multiplex, large or small.</p>
    <p>On that count the eight wards went from ${fmtN(allSix[0])} homes every three months before the new rule to ${fmtN(allSix[1])} after: ${up(allSix)}. The obvious check is the rest of the city, where the rule didn't change. It went from ${fmtN(allFour[0])} to ${fmtN(allFour[1])}: ${up(allFour)}.</p>
    ${catching ? `<p>That looks like the eight wards did worse. But the two parts of the city were not on the same path to begin with. Multiplexes have long been common downtown. In the suburbs they were rare until 2023, and have been spreading fast since, as the chart shows. The suburbs were catching up before the new rule and would have kept catching up without it.</p>` : ""}`;
  $("homes-fig").innerHTML = `<h3 class="sub-h">Homes proposed in multiplexes, every three months</h3>`
    + chart({ labels: cut(Q), lines: [{ name: "The eight wards where six are allowed", color: BLUE, values: cut(arms.plex_homes.six) }, { name: "The rest of the city", color: ORANGE, values: cut(arms.plex_homes.four) }], fmt: fmtN, marks, height: 200 })
    + key([["The eight wards where six are allowed", BLUE, "line"], ["The rest of the city (sixteen wards)", ORANGE, "line"]])
    + `<figcaption>The rest of the city starts near zero, passes the eight wards in 2024 and keeps climbing. Four homes were allowed everywhere from May 2023.</figcaption>`;
  $("homes-after").innerHTML = `So the question is not whether the eight wards kept up with the suburbs, but whether they did better than they were heading for. `
    + `Before the new rule they were ${catching ? "slipping" : "gaining"} against the rest of the city by about ${Math.abs(H.slope).toFixed(0)}% every three months. Our estimate assumes that would have continued but gradually slowed, since a catch-up can't run forever. `
    + `On that path the eight wards were heading for about ${about(H.expected)} homes. They got ${fmtN(H.t1)}.`;
}

// ---- how sure? the answer under each assumption about the catch-up ---------------------------------------------------
function renderSure() {
  const one = check("oneyear");
  const rows = [
    { name: `${catching ? "The suburbs' catch-up" : "The earlier drift"} slowed gradually (our estimate)`, v: H.extra, lo: H.extra_lo, hi: H.extra_hi, main: true },
    { name: "It kept going at full speed", v: F.full.extra },
    { name: "It stopped when the rule changed", v: F.stop.extra },
    { name: "It had already stopped a year earlier", v: one.extra },
    { name: "It was never happening", v: M.extra },
  ];
  const vals = rows.flatMap((r) => [r.v, r.lo, r.hi]).filter((v) => v != null);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), pad = (hi - lo) * 0.06;
  const x = (v) => (((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(2);
  const positive = rows.filter((r) => r.v > 0).length;
  $("sure-lede").innerHTML = `<p>Two things make the estimate uncertain.</p>
    <p><b>First, nobody knows how the catch-up would have gone on.</b> We assumed it would slow gradually, halving its pace every ${halfLife}. Here is the answer under that and four other assumptions.</p>`;
  $("sure").innerHTML = `<ol class="sx-checks">${rows.map((r) => `<li${r.main ? ' class="main"' : ""}><span class="sx-name">${r.name}</span>
      <span class="sx-track" data-tip="${escapeHTML(`${r.name}<br><b>${signed(r.v)}</b> homes${r.main ? `<br>Plausible range ${signed(r.lo)} to ${signed(r.hi)}` : ""}`)}"><span class="sx-one" style="left:${x(0)}%"></span>${r.main ? `<span class="sx-range" style="left:${x(r.lo)}%;width:${(x(r.hi) - x(r.lo)).toFixed(2)}%"></span>` : ""}<span class="sx-dot" style="left:${x(r.v)}%"></span></span>
      <span class="sx-val">${signed(r.v)}</span></li>`).join("")}
    <li class="sx-axis" aria-hidden="true"><span class="sx-name"></span><span class="sx-track"><span style="left:${x(0)}%">no extra homes</span></span><span class="sx-val"></span></li></ol>`;
  const pct = Math.round(H.p * 100), inN = pct > 0 ? Math.round(100 / pct) : null;
  $("sure-after").innerHTML = `<p>${positive >= rows.length - 1 && M.extra <= 0 ? `Every assumption but the last gives a gain. The last ignores the catch-up altogether, and it fails basic tests (see the appendix).` : `${word(positive)} of the ${word(rows.length)} give a gain.`}</p>`
    + `<p><b>Second, eight wards is not many, and wards differ.</b> The blue bar is the plausible range for our estimate. To set it, we ran the same sums on every possible group of eight wards, as if each had been the ones with the new rule. `
    + `${pct >= 1 ? `About one in ${inN <= 20 ? word(inN) : inN} of those made-up groups` : "Almost none of those made-up groups"} showed a gap as large as the real one. ${pct >= 10 ? "That is too common to call the result certain." : "That is uncommon enough to take the result seriously."} `
    + `More months of data will narrow the range.</p>`;
}

// ---- the estimate --------------------------------------------------------------------------------------------------
function renderEstimate() {
  const pct = Math.round(H.p * 100);
  const rel = D.relative.slice(P0), path = (k) => D.paths[k];
  const row = (name, e, note) => `<tr><th>${name}</th><td>${fmtN(e.expected)}</td><td>${signed(e.extra)}</td><td class="txt">${note}</td></tr>`;
  const one = check("oneyear");
  $("est").innerHTML = `<p>The rest of the city stands in for what the eight wards would have done without the by-law. The chart puts the two groups on one line: the eight wards' homes divided by the sixteen's.</p>
    <figure class="panel"><h3 class="sub-h">The eight wards against the other sixteen (1 = their average standing before the by-law)</h3>`
    + chart({ labels: Q.slice(P0), lines: [
      { name: "The trend before", color: MUTED, values: path("fitted") },
      { name: "Never slowing", color: MUTED, dash: true, values: path("full") },
      { name: "Stopping at the by-law", color: MUTED, dash: true, values: path("stop") },
      { name: "Fading (the estimate)", color: ORANGE, dash: true, values: path("fade") },
      { name: "What happened", color: DARK, values: rel }], fmt: (v) => v.toFixed(2), zero: false, marks: [{ at: A0 - P0, label: "By-law" }], height: 220 })
    + key([["What happened", DARK, "line"], ["The trend before the by-law", MUTED, "line"], ["Carried on, fading (the estimate)", ORANGE, "line"], ["Carried on at full pace, or stopped (the dashed grey lines)", MUTED, "line"]])
    + `<figcaption>Homes proposed in multiplex projects in the eight wards, divided by those in the sixteen, each quarter, over the same ratio for all of ${before}. After the by-law, the further the dark line sits above a dashed one, the more homes the eight wards got than that reading expected.</figcaption></figure>
    <ol class="sx-steps">
      <li><b>The trend before</b> (${before}, when four homes were allowed everywhere): the steady rate of change that best fits the eight wards' standing against the sixteen, quarter by quarter. It ${catching ? "falls" : "rises"} about ${Math.abs(H.slope).toFixed(0)}% a quarter.</li>
      <li><b>Carried on, fading.</b> After the by-law the line continues, but each quarter's step is smaller than the last, so that its pace halves every ${halfLife}. A catch-up can't run forever: on this path the eight wards' standing settles at about ${Math.round(H.floor * 100)}% of where it was at the by-law.</li>
      <li><b>Heading for.</b> Each quarter, the sixteen wards' actual homes times the standing the eight were heading for: ${fmtN(H.expected)} homes over ${after}.</li>
      <li><b>The estimate.</b> They had ${fmtN(H.t1)}: ${signed(H.extra)} homes, or ${more(H.ratio)} than they were heading for.</li>
    </ol>
    <p><b>The fade is an assumption.</b> Nothing in this data says how quickly a catch-up runs out, so the halving every ${halfLife} is a choice, not a measurement. What it does to the answer:</p>
    <div class="tbl-wrap"><table class="tbl fc-wrap"><thead><tr><th class="txt">If the ${catching ? "catch-up" : "drift"} had</th><th>Heading for</th><th>Difference</th><th class="txt"></th></tr></thead><tbody>
      ${row("never slowed", F.full, "The most the method gives, and it grows with every quarter added")}
      ${row(`faded, halving every ${halfLife}`, H, "<b>The estimate</b>")}
      ${row("stopped at the by-law", F.stop, "")}
      ${row("ended a year before the by-law", one, "The eight wards held to their standing in the last year before")}
      ${row("never happened", M, "The comparison fixed in advance, below")}
    </tbody></table></div>
    <p><b>The range.</b> Wards differ from one another for all sorts of reasons, so some gap would appear with no by-law at all. To see how much, the whole calculation, trend included, was run for every possible way of calling ${word(six.length)} of the ${six.length + four.length} wards "the sixplex wards": ${D.assignments.toLocaleString("en-CA")} of them. `
    + `${pct >= 1 ? `In ${pct}% of those made-up groupings` : "In fewer than 1% of those made-up groupings"}, the gap was at least as large as the real one. `
    + `The range, ${signed(H.extra_lo)} to ${signed(H.extra_hi)} homes (${more(H.lo)} to ${more(H.hi)}), holds every effect that this test can't rule out at the ${Math.round(D.level * 100)}% level. It is wide because a trend drawn through ${nPre} quarters is a thin thing to extend, and the test charges for that.</p>
    <p>${verdict === "unclear" ? "A range that spans zero means the data is consistent with the by-law having added homes and with its having added none. It does not mean the by-law did nothing." : "A range clear of zero says the eight wards are unusual among groups of wards. It does not prove the by-law is why."}</p>`;
}

// ---- why to doubt it -----------------------------------------------------------------------------------------------
function renderPlan() {
  const fails = (c) => c.p != null && c.p < 0.1, doubtful = (c) => c.p != null && c.p < 0.25;
  const result = (c) => (fails(c) ? "Fails" : doubtful(c) ? "Doubtful" : "Passes");
  const cells = (c) => `<td>${fmtX(c.ratio)}</td><td>${c.p == null ? "—" : `${Math.round(c.p * 100)}%`}</td><td class="txt">${result(c)}</td>`;
  const hp = (k) => D.headline_placebos.find((c) => c.key === k);
  const row = (name, k) => `<tr><th>${name}</th>${cells(placebo(k))}${cells(hp(k))}</tr>`;
  const planOff = D.placebos.filter(doubtful).length, headOff = D.headline_placebos.filter(doubtful).length;
  const count = (n) => (n === 0 ? "none" : n === 3 ? "all three" : `${word(n)} of the three`);
  $("doubt-lede").innerHTML = `This page was first built around a plainer comparison, written down before any result was computed: the eight wards' homes after the by-law over before, against the same for the sixteen. `
    + `It assumes that without the by-law the two groups would have kept their average standing of the two years before. On that reading the eight wards would have seen about ${fmtN(M.expected)} homes and saw ${fmtN(M.t1)}: <b>${signed(M.extra)}</b>, with a range of ${signed(M.extra_lo)} to ${signed(M.extra_hi)}.`;
  $("doubt-after").innerHTML = `<p><b>Why it isn't the headline.</b> Three placebo tests ask a method for an effect where there shouldn't be one. A sound method returns about ×1.00 each time, and a gap as large as its own turns up in plenty of the made-up groupings.</p>
    <div class="tbl-wrap"><table class="tbl fc-wrap"><thead><tr><th></th><th colspan="3">Fixed in advance</th><th colspan="3">The trend, fading</th></tr>
    <tr><th class="txt">Placebo</th><th>Estimate</th><th>Groupings with a gap this large</th><th class="txt">Result</th><th>Estimate</th><th>Groupings with a gap this large</th><th class="txt">Result</th></tr></thead><tbody>
    ${row("A by-law imagined a year early (the two years before, split in half)", "yearearly")}
    ${row("Laneway and garden suites, which the by-law didn't touch", "suites")}
    ${row("New detached houses, which it didn't touch either", "houses")}
    </tbody></table></div>
    <p>The comparison fixed in advance fails or is doubtful on ${count(planOff)}; the fading trend on ${count(headOff)}.${planOff > headOff ? " Where the first one goes wrong, it finds the rest of the city gaining on the eight wards with no by-law to explain it, which is the trend the second one allows for." : ""}
    Read the estimates more than the results. The trend's test is the blunter of the two, because it refits a trend in every grouping: its own estimate of ${fmtX(H.ratio)} turns up in ${Math.round(H.p * 100)}% of them, so a "pass" is easier to get. What counts for it is that its placebo estimates sit ${D.headline_placebos.every((c) => Math.abs(c.ratio - 1) < Math.abs(placebo(c.key).ratio - 1) + 0.05) ? "closer to" : "no further from"} ×1.00.</p>
    <p><b>Its own checks.</b> The checks written down with it, each changing one choice:</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="txt">Fixed in advance, with</th><th>Estimate</th><th>Difference</th></tr></thead><tbody>
    <tr class="sel"><th>nothing changed</th><td>${fmtX(M.ratio)}</td><td>${signed(M.extra)}</td></tr>
    ${D.checks.map((c) => `<tr><th>${PLAN_CHECKS[c.key]()}</th><td>${fmtX(c.ratio)}</td><td>${signed(c.extra)}${c.key === "projects" ? " projects" : ""}</td></tr>`).join("")}
    <tr><th>Leaving out any one ward</th><td>${fmtX(Math.min(...D.leave.map((l) => l.ratio)))} to ${fmtX(Math.max(...D.leave.map((l) => l.ratio)))}</td><td>${signed(Math.min(...D.leave.map((l) => l.extra)))} to ${signed(Math.max(...D.leave.map((l) => l.extra)))}</td></tr>
    </tbody></table></div>
    <p><b>What changing the headline costs.</b> The trend was added to this page as a check, after the first results were in, and was made the headline on ${day(D.changed)}, at the author's choice, with those results in view. A method picked after seeing what each one says deserves less trust than one picked before, however good the reasons. That is why the first estimate stays here in full, and why the fade is shown as a band and not a single number.</p>`;
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
  additive: () => "Homes per ward, not growth rates",
};
const PLAN_CHECKS = { ...CHECKS, oneyear: () => "One year before, not two" };
function renderChecks() {
  const lr = D.headline_leave.map((l) => l.ratio);
  const of = (c) => ({ name: CHECKS[c.key](), ratio: c.ratio, extra: c.extra, unit: c.key === "projects" ? " projects" : "" });
  const rows = [{ name: "The estimate", ratio: H.ratio, lo: H.lo, hi: H.hi, extra: H.extra, main: true },
    { group: `Other assumptions about the ${catching ? "catch-up" : "drift"}` },
    { name: "It never slowed", ratio: F.full.ratio, extra: F.full.extra },
    { name: "It stopped at the by-law", ratio: F.stop.ratio, extra: F.stop.extra },
    { name: "It ended a year before the by-law", ratio: check("oneyear").ratio, extra: check("oneyear").extra },
    { name: "It never happened (fixed in advance)", ratio: M.ratio, lo: M.lo, hi: M.hi, extra: M.extra, plan: true },
    { group: "Other counts and wards, by the estimate's method" },
    ...D.headline_checks.map(of),
    { name: "Leaving out any one ward", lo: Math.min(...lr), hi: Math.max(...lr), span: true },
    { group: "Other methods, with no trend" },
    ...["matched", "additive"].map((k) => of(check(k)))];
  const all = rows.flatMap((r) => [r.ratio, r.lo, r.hi]).filter((v) => v != null);
  const TOP = 4; // a ratio beyond this is drawn at the edge
  const lo = Math.log(Math.min(0.5, ...all) * 0.92), hi = Math.log(Math.min(TOP, Math.max(2, ...all)) * 1.08);
  const x = (r) => Math.min(100, Math.max(0, ((Math.log(r) - lo) / (hi - lo)) * 100)).toFixed(2);
  const ticks = [0.5, 0.67, 1, 1.5, 2, 3].filter((t) => Math.log(t) > lo && Math.log(t) < hi);
  const beyond = rows.filter((r) => r.ratio > TOP);
  $("checks-lede").innerHTML = `Every choice in the method could reasonably have been made another way. Each row below changes one of them and leaves the rest. The blue bar is the estimate's range. `
    + `A dot right of the line says the eight wards got more homes than they were heading for, and left says fewer.`;
  $("checks").innerHTML = `<ol class="sx-checks">${rows.map((r) => {
    if (r.group) return `<li class="sx-group">${r.group}</li>`;
    const ranged = r.main || r.plan;
    const tip = r.span ? `${r.name}<br>From <b>${fmtX(r.lo)}</b> to <b>${fmtX(r.hi)}</b>` : `${r.name}<br><b>${fmtX(r.ratio)}</b> of what was expected (${more(r.ratio)})<br>${signed(r.extra)}${r.unit || " homes"}${ranged ? `<br>Range ${fmtX(r.lo)} to ${fmtX(r.hi)}` : ""}`;
    return `<li${r.main ? ' class="main"' : ""}><span class="sx-name">${r.name}</span>
      <span class="sx-track" data-tip="${escapeHTML(tip)}"><span class="sx-one" style="left:${x(1)}%"></span>${r.lo != null ? `<span class="sx-range${r.main ? "" : " span"}" style="left:${x(r.lo)}%;width:${(x(r.hi) - x(r.lo)).toFixed(2)}%"></span>` : ""}${r.ratio != null ? `<span class="sx-dot${r.ratio > TOP ? " off" : ""}" style="left:${x(r.ratio)}%"></span>` : ""}</span>
      <span class="sx-val">${r.span ? `${fmtX(r.lo)} to ${fmtX(r.hi)}` : `${signed(r.extra)}${r.unit ?? ""}`}</span></li>`;
  }).join("")}
    <li class="sx-axis" aria-hidden="true"><span class="sx-name"></span><span class="sx-track">${ticks.map((t) => `<span style="left:${x(t)}%">${t === 1 ? "no effect" : `×${t}`}</span>`).join("")}</span><span class="sx-val"></span></li></ol>`;
  const same = D.headline_checks, inside = same.filter((c) => c.ratio >= H.lo && c.ratio <= H.hi).length;
  $("checks-note").innerHTML = `The figure at the right is the difference in homes (the scale is the ratio to what was expected: ×1.5 is half as many again). The grey bars are the range of the comparison fixed in advance, and the spread from leaving out one ward. `
    + `${inside === same.length ? `All ${word(same.length)}` : `${inside} of the ${same.length}`} checks by the estimate's method fall inside its range. `
    + (beyond.length ? `An open dot is off the scale: ${beyond.map((r) => `"${r.name}" is ${fmtX(r.ratio)}, because a trend carried on from a count that small runs to almost nothing`).join("; ")}. ` : "")
    + `"Similar" wards are the nearest on how many homes were proposed before the by-law and how fast that was growing.`;
}

// ---- ward by ward ------------------------------------------------------------------------------------------------------
function renderWards() {
  const order = { six: 0, four: 1, early: 2 };
  const rows = [...D.wards].sort((a, b) => order[a.arm] - order[b.arm] || b.post - a.post);
  const rule = { six: "Six", four: "Four", early: "Six, from Feb 2025" };
  $("wards-lede").innerHTML = `Homes proposed in multiplex projects, as a rate per quarter so that the two periods compare, and the projects of five or six homes since the by-law. No one ward makes the result: without any single ward the estimate stays between ${signed(Math.min(...D.headline_leave.map((l) => l.extra)))} and ${signed(Math.max(...D.headline_leave.map((l) => l.extra)))} homes.`;
  $("wards").innerHTML = `<thead><tr><th class="txt">Ward</th><th class="txt">Homes allowed</th><th>Homes a quarter, before</th><th>After</th><th>Change</th><th>Projects of five or six, after</th></tr></thead><tbody>${rows.map((w) => {
    const a = w.pre / nPre, b = w.post / nPost;
    return `<tr${w.arm === "six" ? ' class="sel"' : ""}><th>${escapeHTML(w.name)} <span class="small">${+w.ward}</span></th><td class="txt">${rule[w.arm]}</td><td>${a.toFixed(1)}</td><td>${b.toFixed(1)}</td><td>${w.pre >= 8 ? `${b >= a ? "+" : "−"}${Math.round(Math.abs(b / a - 1) * 100)}%` : "—"}</td><td>${w.big_post}</td></tr>`;
  }).join("")}</tbody>
    <caption>Before: ${before}. After: ${after}. A change isn't given where a ward had fewer than eight homes proposed before.</caption>`;
  $("others-fig").innerHTML = `<h3 class="sub-h">The other sixteen wards: homes proposed, by quarter</h3>`
    + chart({ labels: pane.labels(), bars: pane.bars("four"), fmt: fmtN, marks, height: 200 })
    + key([["In buildings of up to four homes", LIGHT], ["In buildings of five or six", DARK]]);
}

// ---- what this can't show, and how it was done ------------------------------------------------------------------------
function renderCant() {
  $("cant").innerHTML = [
    `<b>Whether the homes get built.</b> These are applications. Some will be refused or dropped, and a multiplex takes a year or more to finish.`,
    `<b>The long run.</b> The rule is ${nPost * 3} months old in this data. An early rush or a slow start would both mislead.`,
    `<b>The zoning on its own.</b> A month later Council also waived development charges on these buildings. The estimate is of both changes together.`,
    `<b>Whether the city as a whole gained.</b> If the rule drew builders downtown who would otherwise have built in the suburbs, some of the gain is homes moved, not homes added.`,
    `<b>Anything about who lives there.</b> Nothing here bears on rents, prices, what was demolished, or what neighbours think.`,
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
    <li><b>The estimate</b> works in ratios, because the two groups differ in size and the counts are small. A straight line is fitted to the logarithm of the eight wards' homes over the sixteen's, by quarter, over "before". From the line's level at the end of "before" it is carried on with each quarter's step ${H.phi.toFixed(2)} times the last (the pace halving every ${halfLife}). The sixteen wards' homes each quarter after, times that ratio, are what the eight were heading for.</li>
    <li><b>The estimate fixed in advance</b> is the eight wards' homes after over before, divided by the same for the sixteen.</li>
    <li><b>The range</b> comes from a permutation test over all ${D.assignments.toLocaleString("en-CA")} ways of choosing ${word(six.length)} wards of ${six.length + four.length}. The trend is fitted afresh in each. It treats the wards as interchangeable, which they are not, so it measures how unusual the eight are among groups of wards and not the chance of an error in a designed trial.</li>
    <li><b>Fixed in advance, mostly.</b> The outcome, the wards, the periods, the estimate, the checks and the placebos were written down on ${day(D.fixed)}, before any estimate was computed, but after rough counts of permits by size and half-year had been looked at for each group of wards. A check that carried the earlier trend forward was added after the first results.</li>
    <li><b>The headline changed, after the results.</b> On ${day(D.changed)} the author made the trend the headline, fading, in place of the estimate fixed in advance, with both sets of results in view. The first estimate, its range, its checks and its placebos are all still on this page, under "The comparison fixed in advance".</li>
    <li><b>Rebuilt once, after the first results.</b> The first version counted projects its own way: permits of the City's "3+ Unit" types, placed by address, with a project of "five or six" one that added that many homes. On ${day(D.rebuilt)} it was rebuilt on the Housing page's list so that the two pages count the same projects. The outcome, wards, periods, estimate and range stayed as fixed. The estimate fixed in advance moved from ${signed(D.before_rebuild.extra)} homes (range ${signed(D.before_rebuild.extra_lo)} to ${signed(D.before_rebuild.extra_hi)}) to ${signed(M.extra)} (${signed(M.extra_lo)} to ${signed(M.extra_hi)}). Two checks changed with it: "a wider definition" became "new buildings only", and "the building's homes" was added.</li>
    <li><b>The eight wards weren't picked at random.</b> They are the old city: smaller lots, older houses, more transit, dearer land and a longer history of duplexes and triplexes. The rest of the city is the best stand-in available, and it was on a path of its own.</li>
    <li><b>How many homes a project adds</b> is what its permit says. ${fmtN(D.counted["projects on the list with no homes created on a permit"])} projects on the list state none and add nothing here, and the City's counts are not audited. Owners outside the eight wards also got five or six homes by other routes (${fmtN(big.fourPost)} projects), which narrows the gap between the groups.</li>
    <li><b>The development-charge waiver</b> of July 2025 is dated here from news reports, not from a Council record.</li>
    <li><b>It will move.</b> The page is rebuilt when the permit files are refreshed, each quarter adding to "after". Later revisions, refusals and withdrawals change earlier quarters too.</li>
  </ul>
  <p>The code is <a href="https://github.com/vrraiv/sixfigures/blob/main/pipeline/sixplex.py"><code>pipeline/sixplex.py</code></a> (the counts) and <a href="https://github.com/vrraiv/sixfigures/blob/main/pipeline/sixplex_insights.py"><code>pipeline/sixplex_insights.py</code></a> (the estimates), and the table of homes by ward and month is <a href="https://github.com/vrraiv/sixfigures/tree/main/pipeline/sixplex">in the repository</a>.</p>`;
}

renderMap();
renderAnswer();
renderCame();
renderHomes();
renderSure();
renderEstimate();
renderPlan();
renderChecks();
renderWards();
renderCant();
renderHow();
buildToc();
