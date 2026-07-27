import { describe, expect, it } from "vitest";
import { SPEED_DRAG_GAIN_PER_SPAN } from "./gestureRecognition";
import { SPEED_DEADBAND, SPEED_MAX, SpeedSlider } from "./speedControl";

const SCALE = 0.25;

/** Pinch-drags by `spans` hand-spans upward from `fromY`, in one step. */
function drag(slider: SpeedSlider, fromY: number, spans: number) {
  slider.apply("adjusting", fromY, SCALE);
  return slider.apply("adjusting", fromY - spans * SCALE, SCALE);
}

describe("speed slider drag", () => {
  it("starts at zero so nothing moves until a speed is chosen", () => {
    expect(new SpeedSlider().current()).toBe(0);
  });

  it("converts one hand-span of upward travel into the drag gain", () => {
    const slider = new SpeedSlider();
    const result = drag(slider, 0.6, 1);
    expect(result.value).toBe(SPEED_DRAG_GAIN_PER_SPAN);
    expect(result.gesture).toBe("adjusting");
    expect(result.locked).toBe(false);
  });

  it("drags relative to the grab point, not the hand's absolute height", () => {
    const high = new SpeedSlider();
    const low = new SpeedSlider();
    // Same travel, grabbed at very different heights: same result.
    expect(drag(high, 0.2, 0.5).value).toBe(drag(low, 0.9, 0.5).value);
  });

  it("clamps to the 0..1000 range", () => {
    const slider = new SpeedSlider();
    expect(drag(slider, 0.9, 10).value).toBe(SPEED_MAX);
    slider.apply("locked", 0, SCALE);
    expect(drag(slider, 0.1, -10).value).toBe(0);
  });

  it("ignores drags below the deadband", () => {
    const slider = new SpeedSlider();
    slider.apply("adjusting", 0.5, SCALE);
    const creep = (SPEED_DEADBAND - 1) / SPEED_DRAG_GAIN_PER_SPAN;
    expect(slider.apply("adjusting", 0.5 - creep * SCALE, SCALE).value).toBe(0);
  });

  it("releasing and re-grabbing continues from the current value", () => {
    const slider = new SpeedSlider();
    drag(slider, 0.6, 0.5);
    const afterFirst = slider.current();
    expect(afterFirst).toBeGreaterThan(0);

    slider.apply("locked", 0.6, SCALE);
    expect(slider.isPinching()).toBe(false);

    const result = drag(slider, 0.3, 0.5);
    expect(result.value).toBe(afterFirst * 2);
  });
});

describe("speed hand leaving the frame", () => {
  it("holds the value instead of resetting it", () => {
    const slider = new SpeedSlider();
    drag(slider, 0.6, 1);
    const chosen = slider.current();

    for (let frame = 0; frame < 60; frame += 1) {
      const held = slider.hold();
      expect(held.value).toBe(chosen);
      expect(held.gesture).toBe("absent");
      // Held, not being dragged: the DRIVE packet keeps the SPEED_LOCKED flag.
      expect(held.locked).toBe(true);
    }
  });

  it("releases an in-progress grab so the hand returning re-grabs cleanly", () => {
    const slider = new SpeedSlider();
    slider.apply("adjusting", 0.6, SCALE);
    expect(slider.isPinching()).toBe(true);

    slider.hold();
    expect(slider.isPinching()).toBe(false);

    // Coming back much lower in the frame must not be read as a huge downward
    // drag against the old grab point — it starts a new grab at the new height.
    const resumed = slider.apply("adjusting", 0.95, SCALE);
    expect(resumed.value).toBe(slider.current());
    expect(slider.isPinching()).toBe(true);
  });

  it("treats an invalid pose exactly like an absent hand", () => {
    const slider = new SpeedSlider();
    drag(slider, 0.6, 1);
    const chosen = slider.current();

    const invalid = slider.apply("invalid", 0.6, SCALE);
    expect(invalid.value).toBe(chosen);
    expect(invalid.locked).toBe(true);
    // A half-formed hand must not be more dangerous than no hand at all: both
    // hold, neither stops the vehicle.
    expect(invalid.value).toBe(slider.hold().value);
  });

  it("reset() clears the value for a fresh role setup", () => {
    const slider = new SpeedSlider();
    drag(slider, 0.6, 1);
    slider.reset();
    expect(slider.current()).toBe(0);
    expect(slider.isPinching()).toBe(false);
  });
});
