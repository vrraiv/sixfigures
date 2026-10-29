// Mouse-wheel zoom that stays put when frames are slow.
//
// MapLibre's own scroll handler guesses whether a wheel event came from a
// mouse or a trackpad and zooms 4.5× faster per pixel for a trackpad. A mouse
// driver with smooth scrolling (ThinkPads, Logitech) splits each notch into
// dozens of small events, which that guess reads as a trackpad: one notch then
// moves about three times what a plain mouse notch does. Worse, the handler
// applies every event that queued up during a slow frame in one go, up to a
// whole zoom level per frame. A level change loads new tiles, which makes the
// next frame slow, which lets another level's worth of input pile up: on a
// laptop with 1-second frames the zoom runs to its limit and cannot be caught.
//
// This handler is linear, so a notch zooms the same however the driver splits
// it, and it is bounded three ways: input waiting to be applied is capped at
// QUEUE levels (anything further is dropped, not saved up), a frame applies at
// most STEP levels, and the target never leads the zoom on screen by more
// than LEAD levels. Stopping the wheel stops the map within a frame or two.

export const RATE = 450; // wheel pixels per zoom level (one plain mouse notch is 100 px)
export const PINCH = 4.5; // browsers send a trackpad pinch as a ctrl+wheel with small deltas
export const STEP = 0.25; // most levels applied in one frame
export const QUEUE = 0.5; // most levels of input kept waiting for a frame
export const LEAD = 1; // most levels the target may be ahead of the zoom on screen

const LINE = 40; // px per line for deltaMode 1 (Firefox with some mice)
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// The pure part, so it can be tested without a DOM or a map: `view` supplies
// getZoom/minZoom/maxZoom and ease(zoom, around); `raf` schedules a frame.
export class WheelZoom {
  constructor(view, raf) {
    this.view = view;
    this.raf = raf;
    this.pending = 0; // levels of input not yet applied; negative zooms out
    this.target = null; // zoom the current ease is heading for
    this.around = null;
    this.frame = 0;
  }

  // Takes a wheel event's deltaY, deltaMode and ctrlKey with the pointer position.
  wheel(deltaY, deltaMode, ctrlKey, around) {
    if (!deltaY) return;
    let px = deltaMode === 1 ? deltaY * LINE : deltaMode === 2 ? deltaY * LINE * 20 : deltaY;
    if (ctrlKey) px *= PINCH;
    this.pending = clamp(this.pending - px / RATE, -QUEUE, QUEUE);
    this.around = around;
    if (!this.frame) this.frame = this.raf(() => this.apply());
  }

  apply() {
    this.frame = 0;
    const { view } = this;
    const zoom = view.getZoom();
    const step = clamp(this.pending, -STEP, STEP);
    this.pending -= step;
    // Carry the target over only while our ease is still running towards it.
    const from = this.target != null && Math.abs(this.target - zoom) <= LEAD ? this.target : zoom;
    const target = clamp(clamp(from + step, zoom - LEAD, zoom + LEAD), view.minZoom, view.maxZoom);
    if (target !== zoom) view.ease(target, this.around);
    this.target = target;
    if (this.pending) this.frame = this.raf(() => this.apply());
  }

  // The ease ended (or something else moved the map): start again from the screen.
  settle() {
    this.target = null;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function wheelZoom(map) {
  map.scrollZoom.disable();
  const canvas = map.getCanvas();
  const view = {
    getZoom: () => map.getZoom(),
    get minZoom() { return map.getMinZoom(); },
    get maxZoom() { return map.getMaxZoom(); },
    ease: (zoom, around) =>
      map.easeTo({ zoom, around, duration: 200, easing: easeOut, easeId: "wheel" }, { originalEvent: lastEvent }),
  };
  const wz = new WheelZoom(view, (fn) => requestAnimationFrame(fn));
  let lastEvent = null;
  map.getCanvasContainer().addEventListener("wheel", (e) => {
    e.preventDefault();
    lastEvent = e;
    const r = canvas.getBoundingClientRect();
    wz.wheel(e.deltaY, e.deltaMode, e.ctrlKey, map.unproject([e.clientX - r.left, e.clientY - r.top]));
  }, { passive: false });
  map.on("moveend", () => wz.settle());
  return wz;
}
