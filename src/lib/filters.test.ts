import { describe, expect, it } from "vitest";
import {
  applyDeadzone,
  applyRadialDeadzone,
  clamp,
  ema,
  hysteresisActive,
  normalizeRange,
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
});
