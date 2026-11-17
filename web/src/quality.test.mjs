// Map detail (quality.js): the software-renderer check and the level a measurement calls for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSoftware, levelFor } from "./quality.js";

test("software WebGL renderers are recognised, graphics chips are not", () => {
  for (const r of [
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "Google SwiftShader",
    "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "llvmpipe (LLVM 15.0.7, 256 bits)",
  ]) assert.ok(isSoftware(r), r);
  for (const r of [
    "ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Apple M2",
    "WebKit WebGL (masked)",
    "Adreno (TM) 740", // "warp" only as a word: no chip name should trip it
    null,
  ]) assert.ok(!isSoftware(r), r);
});

test("a frame timed at full detail uses the thresholds as they stand", () => {
  assert.equal(levelFor({ rest: 16.7, repaint: 20 }), "full");
  assert.equal(levelFor({ rest: 16.7, repaint: 60 }), "medium");
  assert.equal(levelFor({ rest: 16.7, repaint: 320 }), "low");
  assert.equal(levelFor({ rest: 16.7, repaint: null }), null);
});

test("a frame timed at medium or low is scaled to full's cost", () => {
  // a graphics card: a frame barely past the display's interval steps up to full
  assert.equal(levelFor({ rest: 16.7, repaint: 18 }, "medium"), "full");
  // about 45 ms past it at full, so about 16 at medium: medium stays
  assert.equal(levelFor({ rest: 16.7, repaint: 32 }, "medium"), "medium");
  // a software renderer at low (the laptop that prompted this: ~300 ms at full)
  assert.equal(levelFor({ rest: 33, repaint: 110 }, "low"), "low");
  // what went wrong before: low's 70 ms, read against full's thresholds, called for medium
  assert.equal(levelFor({ rest: 16.7, repaint: 87 }), "medium");
  assert.equal(levelFor({ rest: 16.7, repaint: 87 }, "low"), "low");
});
