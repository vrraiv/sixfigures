// Writes the site's icons into web/public from the header's map (scripts/city-map.mjs):
//
//   favicon.svg            browser tabs
//   favicon.ico            16, 32 and 48 px, for browsers that want an .ico
//   apple-touch-icon.png   180 px, square (iOS rounds the corners itself)
//   social-card.png        1200 x 630, the picture a shared link shows (site-nav.mjs socialTags)
//
// The icons are committed; run this again when the map changes (a new census):
//
//   node scripts/make-icons.mjs
//
// The .svg needs nothing. The others are drawn by a browser, through Playwright, which is not
// one of the project's packages: with it installed globally, NODE_PATH="$(npm root -g)" finds it
// (playwright, or playwright-core driving the Chrome already on the machine). Without it only the
// .svg is written.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { brandSvg, cityMap, heroKey, iconSvg } from "./city-map.mjs";
import { CARD, ROWS, SITE } from "./site-nav.mjs";

const OUT = "web/public";
const m = cityMap();
const svg = iconSvg(m);
writeFileSync(`${OUT}/favicon.svg`, svg);
console.log("favicon.svg");

let chromium, channel;
const need = createRequire(import.meta.url);
try {
  ({ chromium } = need("playwright"));
} catch {
  try {
    ({ chromium } = need("playwright-core"));
    channel = "chrome";
  } catch {
    console.log("Playwright not found: favicon.ico, apple-touch-icon.png and social-card.png left as they were.");
    process.exit(0);
  }
}

const browser = await chromium.launch(channel ? { channel } : {});
const png = async (source, size) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0"><img width="${size}" height="${size}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}"></body>`);
  const shot = await page.screenshot({ omitBackground: true });
  await page.close();
  return shot;
};

// An .ico holding PNGs: a 6-byte header, a 16-byte entry per image, then the images.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(svg, s)));
const head = Buffer.alloc(6 + 16 * images.length);
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(images.length, 4);
let at = head.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(sizes[i], e); // width
  head.writeUInt8(sizes[i], e + 1); // height
  head.writeUInt16LE(1, e + 4); // colour planes
  head.writeUInt16LE(32, e + 6); // bits per pixel
  head.writeUInt32LE(img.length, e + 8);
  head.writeUInt32LE(at, e + 12);
  at += img.length;
});
writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([head, ...images]));
console.log("favicon.ico");

writeFileSync(`${OUT}/apple-touch-icon.png`, await png(iconSvg(m, { rx: 0, pad: 3 }), 180));
console.log("apple-touch-icon.png");

// The card a shared link shows: the site's name and what it covers beside the city map, in the
// pages' own colours and type.
{
  const page = await browser.newPage({ viewport: { width: CARD.width, height: CARD.height }, deviceScaleFactor: 1 });
  const labels = ROWS[0].links.map((l) => l.label), half = Math.ceil(labels.length / 2);
  const topics = [labels.slice(0, half), labels.slice(half)].map((g) => g.join(" · ")).join("<br>"); // two lines, neither starting with a dot
  await page.setContent(`<body style="margin:0;width:${CARD.width}px;height:${CARD.height}px;box-sizing:border-box;padding:56px 64px;background:#fcfcfb;color:#1a1a19;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:grid;grid-template-columns:400px 1fr;gap:40px;align-items:center">
    <div>
      <div style="font-size:76px;font-weight:700;line-height:1;color:#0d366b;letter-spacing:-1px">${SITE.title}</div>
      <div style="font-size:31px;margin-top:18px;color:#4b4b47">${SITE.sub}</div>
      <div style="font-size:23px;line-height:1.5;margin-top:44px;color:#4b4b47">${topics}</div>
      <div style="font-size:19px;margin-top:44px;color:#6b6b66">Median household income by neighbourhood, 2021 Census</div>
      <style>.home-key{list-style:none;margin:12px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:17px;color:#4b4b47}.home-key span{display:inline-block;width:16px;height:16px;border-radius:3px;margin-right:8px;vertical-align:-2px}</style>
      ${heroKey(m)}
    </div>
    <img style="width:100%;display:block" src="data:image/svg+xml;base64,${Buffer.from(brandSvg(m)).toString("base64")}">
  </body>`);
  writeFileSync(`${OUT}${CARD.src}`, await page.screenshot());
  await page.close();
  console.log(CARD.src.slice(1));
}
await browser.close();
