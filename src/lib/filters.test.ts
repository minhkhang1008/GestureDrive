import { describe, expect, it } from "vitest";
import {
  applyDeadzone,
  applyRadialDeadzone,
  clamp,
  ema,
  hysteresisActive,
  normalizeRange,
  OneEuroFilter,
  OneEuroPointFilter,
} from "./filters";

describe("control filters", () => {
  it("clamps and normalizes finite ranges", () => {
    expect(clamp(15, -10, 10)).toBe(10);
    expect(clamp(-15, -10, 10)).toBe(-10);
    expect(normalizeRange(50, 0, 100)).toBe(0.5);
    expect(normalizeRange(200, 0, 100)).toBe(1);
  });

  it("removes the deadzone and rescales the remaining travel", () => {
    expect(applyDeadzone(0.09, 0.1)).toBe(0);
    expect(applyDeadzone(-0.1, 0.1)).toBe(0);
    expect(applyDeadzone(1, 0.1)).toBe(1);
    expect(applyRadialDeadzone(0.03, 0.04, 0.1)).toEqual({ x: 0, y: 0 });
  });

  it("uses separate enter and exit thresholds", () => {
    expect(hysteresisActive(0.1, false, 0.12, 0.08)).toBe(false);
    expect(hysteresisActive(0.13, false, 0.12, 0.08)).toBe(true);
    expect(hysteresisActive(0.1, true, 0.12, 0.08)).toBe(true);
    expect(hysteresisActive(0.07, true, 0.12, 0.08)).toBe(false);
  });

  it("applies an exponential moving average", () => {
    expect(ema(0, 100, 0.3)).toBe(30);
    expect(ema(30, 100, 0.3)).toBe(51);
  });

  it("pins hysteresis boundary semantics: enter inclusive, exit exclusive", () => {
    // Entering: value >= enterThreshold activates (inclusive boundary).
    expect(hysteresisActive(0.12, false, 0.12, 0.08)).toBe(true);
    expect(hysteresisActive(0.119, false, 0.12, 0.08)).toBe(false);
    // Staying active: value must be strictly > exitThreshold, so landing
    // exactly on the exit threshold deactivates (exclusive boundary).
    expect(hysteresisActive(0.08, true, 0.12, 0.08)).toBe(false);
    expect(hysteresisActive(0.081, true, 0.12, 0.08)).toBe(true);
    // Magnitude sign is ignored.
    expect(hysteresisActive(-0.5, false, 0.12, 0.08)).toBe(true);
  });

  it("handles radial deadzone edge cases", () => {
    // Exactly on the deadzone radius is still inside (<= comparison).
    expect(applyRadialDeadzone(0.1, 0, 0.1)).toEqual({ x: 0, y: 0 });
    // Zero vector with zero deadzone must not divide 0 by 0.
    expect(applyRadialDeadzone(0, 0, 0)).toEqual({ x: 0, y: 0 });
    // Direction is preserved and the magnitude is rescaled.
    const scaled = applyRadialDeadzone(0.3, 0.4, 0.1);
    expect(scaled.x / scaled.y).toBeCloseTo(0.75, 10);
    expect(Math.hypot(scaled.x, scaled.y)).toBeCloseTo(4 / 9, 6);
    // Far outside the unit circle saturates at magnitude 1.
    expect(applyRadialDeadzone(5, 0, 0.1)).toEqual({ x: 1, y: 0 });
  });
});

describe("One-Euro filter", () => {
  const FRAME_MS = 1000 / 30;

  it("returns the first sample unchanged", () => {
    expect(new OneEuroFilter().filter(0.123, 999)).toBe(0.123);
  });

  it("converges to a constant input", () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 0);
    let output = 0;
    for (let i = 1; i <= 60; i += 1) output = filter.filter(1, i * FRAME_MS);
    expect(output).toBeCloseTo(1, 4);
  });

  it("attenuates small alternating jitter at 30 fps", () => {
    const filter = new OneEuroFilter();
    filter.filter(0.5, 0);
    const outputs: number[] = [];
    for (let i = 1; i <= 90; i += 1) {
      outputs.push(filter.filter(0.5 + (i % 2 === 0 ? 0.002 : -0.002), i * FRAME_MS));
    }
    const settled = outputs.slice(30);
    const outputRange = Math.max(...settled) - Math.min(...settled);
    expect(outputRange).toBeLessThan(0.004); // strictly below the input peak-to-peak
    expect(outputRange).toBeLessThan(0.001); // and strongly attenuated, not borderline
  });

  it("follows a large step within a few frames (adaptive cutoff)", () => {
    const filter = new OneEuroFilter();
    let timeMs = 0;
    for (let i = 0; i <= 30; i += 1) {
      filter.filter(0, timeMs);
      timeMs += FRAME_MS;
    }
    let output = 0;
    for (let i = 0; i < 10; i += 1) {
      output = filter.filter(0.5, timeMs);
      timeMs += FRAME_MS;
    }
    // The speed-adaptive cutoff must have covered >80% of the 0.5 step
    // within 10 frames (a fixed 1.2 Hz low-pass would lag far behind).
    expect(output).toBeGreaterThan(0.4);
    expect(output).toBeLessThanOrEqual(0.5);
  });

  it("reseeds on a non-increasing timestamp instead of producing NaN", () => {
    const filter = new OneEuroFilter();
    filter.filter(0.5, 100);
    filter.filter(0.6, 133);
    // Same timestamp: delta would be 0, so the filter reseeds and passes
    // the sample through untouched.
    expect(filter.filter(10, 133)).toBe(10);
    // Time going backwards also reseeds.
    expect(filter.filter(-5, 50)).toBe(-5);
    expect(Number.isNaN(filter.filter(-5, 83))).toBe(false);
  });

  it("reset() clears state so the next sample passes through", () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 0);
    filter.filter(100, 33);
    filter.reset();
    expect(filter.filter(42, 66)).toBe(42);
  });

  it("point filter runs the two axes independently and identically to scalar filters", () => {
    const pointFilter = new OneEuroPointFilter();
    const xFilter = new OneEuroFilter();
    const yFilter = new OneEuroFilter();
    for (let i = 0; i <= 20; i += 1) {
      const timeMs = i * FRAME_MS;
      const sample = { x: Math.sin(i / 3) * 0.2 + 0.5, y: 0.7 - i * 0.01 };
      const filtered = pointFilter.filter(sample, timeMs);
      expect(filtered.x).toBe(xFilter.filter(sample.x, timeMs));
      expect(filtered.y).toBe(yFilter.filter(sample.y, timeMs));
    }
  });
});
