// Writes the site's icons into web/public from the header's map (scripts/city-map.mjs):
//
//   favicon.svg            browser tabs
//   favicon.ico            16, 32 and 48 px, for browsers that want an .ico
//   apple-touch-icon.png   180 px, square (iOS rounds the corners itself)
//
// The icons are committed; run this again when the map changes (a new census):
//
//   node scripts/make-icons.mjs
//
// The .svg needs nothing. The other two are drawn by a browser, through Playwright, which is not
// one of the project's packages: with it installed globally, NODE_PATH="$(npm root -g)" finds it.
// Without it only the .svg is written.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cityMap, iconSvg } from "./city-map.mjs";

const OUT = "web/public";
const m = cityMap();
const svg = iconSvg(m);
writeFileSync(`${OUT}/favicon.svg`, svg);
console.log("favicon.svg");

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("Playwright not found: favicon.ico and apple-touch-icon.png left as they were.");
  process.exit(0);
}

const browser = await chromium.launch();
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
await browser.close();
