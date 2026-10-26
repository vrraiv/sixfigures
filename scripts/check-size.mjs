// Fail the build if the shipped site (web/dist) exceeds the 10 MB budget.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 10 * 1024 * 1024;
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [statSync(join(dir, e.name)).size]);
const total = walk("web/dist").reduce((a, b) => a + b, 0);
const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`web/dist: ${mb(total)} MB of ${mb(LIMIT)} MB budget`);
if (total > LIMIT) {
  console.error("Shipped payload exceeds the 10 MB budget.");
  process.exit(1);
}
