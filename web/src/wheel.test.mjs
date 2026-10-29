// node --test web/src/wheel.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { LEAD, QUEUE, RATE, STEP, WheelZoom } from "./wheel.js";

// A map whose zoom follows each ease instantly (fast frames) or not at all
// (a main thread stalled on tile loading) until `land()` is called.
function harness({ stalled = false, zoom = 12 } = {}) {
  const view = {
    zoom, minZoom: 0, maxZoom: 22, eases: [],
    getZoom: () => view.zoom,
    ease(target) { view.eases.push(target); if (!stalled) view.zoom = target; },
    land() { if (view.eases.length) view.zoom = view.eases.at(-1); },
  };
  const frames = [];
  const wz = new WheelZoom(view, (fn) => frames.push(fn) && frames.length);
  // Runs the queued frames in order, as rAF would, until none are pending.
  const frame = () => { const f = frames.shift(); if (f) f(); };
  const drain = () => { while (frames.length) frame(); };
  return { view, wz, frame, drain, frames };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("one plain mouse notch zooms in by 100 px worth", () => {
  const h = harness();
  h.wz.wheel(-100, 0, false, null);
  h.drain();
  near(h.view.zoom, 12 + 100 / RATE, "zoom");
  assert.equal(h.view.eases.length, 1);
});

test("a notch split into a smooth-scroll stream zooms the same as one event", () => {
  const h = harness();
  // A ThinkPad T14 sends ~35 tapering events per notch; this stream also sums to 100.
  const stream = [11, 11, 10, 9, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  assert.equal(stream.reduce((a, b) => a + b), 100);
  for (const dy of stream) { h.wz.wheel(-dy, 0, false, null); h.frame(); }
  h.drain();
  near(h.view.zoom, 12 + 100 / RATE, "zoom");
});

test("a frame applies at most STEP and the queue keeps at most QUEUE", () => {
  const h = harness();
  h.wz.wheel(-RATE * 3, 0, false, null); // three levels asked for at once
  h.frame();
  near(h.view.zoom, 12 + STEP, "first frame");
  h.drain();
  near(h.view.zoom, 12 + QUEUE, "all that was kept");
});

test("a stalled main thread never lets the target run away", () => {
  const h = harness({ stalled: true });
  // Ten notches arrive while the screen is stuck at zoom 12.
  for (let i = 0; i < 10; i++) { h.wz.wheel(-100, 0, false, null); h.frame(); }
  h.drain();
  for (const t of h.view.eases) assert.ok(t <= 12 + LEAD, `target ${t} within LEAD of the screen`);
  near(h.view.eases.at(-1), 12 + LEAD, "the target stops one level ahead");
  // The frame finally lands; the dropped notches are gone, not applied late.
  h.view.land();
  h.wz.wheel(-100, 0, false, null);
  h.drain();
  near(h.view.eases.at(-1), 12 + LEAD + 100 / RATE, "one more notch after landing");
});

test("reversing the wheel cancels what is still queued", () => {
  const h = harness();
  h.wz.wheel(-RATE, 0, false, null); // one level in (queue keeps QUEUE)
  h.frame(); // STEP applied
  h.wz.wheel(RATE, 0, false, null); // one level out
  h.drain();
  near(h.view.zoom, 12 + STEP - QUEUE, "net");
});

test("line-mode deltas and trackpad pinches are scaled, the zoom range is respected", () => {
  let h = harness();
  h.wz.wheel(-3, 1, false, null); // Firefox: 3 lines = 120 px
  h.drain();
  near(h.view.zoom, 12 + 120 / RATE, "lines");
  h = harness();
  h.wz.wheel(-10, 0, true, null); // pinch: small deltas, scaled up
  h.drain();
  near(h.view.zoom, 12 + 45 / RATE, "pinch");
  h = harness({ zoom: 21.9 });
  h.wz.wheel(-RATE, 0, false, null);
  h.drain();
  assert.equal(h.view.zoom, 22);
});
