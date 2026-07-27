import { describe, expect, it } from "vitest";
import { createDirectionalDrive, type DirectionCode } from "./commands";
import { createDriveCommand } from "./controlTypes";
import {
  applyOutputLimit,
  FIRMWARE_K_TURN,
  FIRMWARE_MAX_PWM,
  joystickToDrive,
  mixDifferentialDrive,
  scaleDriveOutput,
  type MotorPair,
} from "./driveMixer";

describe("differential mixer", () => {
  it("drives straight with equal wheel outputs", () => {
    expect(mixDifferentialDrive(1000, 0)).toEqual({ left: 1000, right: 1000 });
    expect(mixDifferentialDrive(-1000, 0)).toEqual({ left: -1000, right: -1000 });
  });

  it("pivots left with counter-rotating wheels scaled by turnGain", () => {
    // Positive steering = turn left: left wheel reverses, right advances.
    expect(mixDifferentialDrive(0, 1000, 0.7)).toEqual({ left: -700, right: 700 });
  });

  it("normalizes saturation while preserving the wheel ratio", () => {
    // Raw mix: left = 1000 - 700 = 300, right = 1000 + 700 = 1700 -> peak 1700.
    const mixed = mixDifferentialDrive(1000, 1000, 0.7);
    expect(Math.max(Math.abs(mixed.left), Math.abs(mixed.right))).toBeLessThanOrEqual(1000);
    expect(mixed.right).toBe(1000);
    expect(mixed.left / mixed.right).toBeCloseTo(300 / 1700, 2);
  });

  it("outputs zero for zero input", () => {
    expect(mixDifferentialDrive(0, 0)).toEqual({ left: 0, right: 0 });
  });

  it("clamps out-of-range channel input before mixing", () => {
    expect(mixDifferentialDrive(5000, 0)).toEqual({ left: 1000, right: 1000 });
  });
});

describe("output limiting semantics", () => {
  it("applyOutputLimit CLAMPS each channel independently (saturating, ratio-distorting)", () => {
    // Only the saturating channel is touched; the other keeps its value, so
    // the left/right ratio is NOT preserved. This mirrors the firmware's
    // final hard PWM ceiling.
    expect(applyOutputLimit({ left: 1000, right: 100 }, 600)).toEqual({ left: 600, right: 100 });
    expect(applyOutputLimit({ left: 900, right: -800 }, 600)).toEqual({ left: 600, right: -600 });
  });

  it("scaleDriveOutput SCALES both channels proportionally (ratio-preserving)", () => {
    // Both channels shrink by speedLimit/1000, so the ratio survives. This is
    // how DRIVE commands apply the speed limit.
    expect(scaleDriveOutput({ left: 1000, right: 100 }, 600)).toEqual({ left: 600, right: 60 });
    expect(scaleDriveOutput({ left: -500, right: 250 }, 400)).toEqual({ left: -200, right: 100 });
  });

  it("treats a zero or negative limit as full stop in both semantics", () => {
    // NOTE: the reverse channel stops at -0, not +0 (clamping/scaling a
    // negative value to a zero limit preserves the sign of zero). Harmless
    // downstream — String(-0) is "0" and -0 === 0 — but pinned exactly here.
    expect(applyOutputLimit({ left: 900, right: -900 }, 0)).toEqual({ left: 0, right: -0 });
    expect(scaleDriveOutput({ left: 900, right: -900 }, -100)).toEqual({ left: 0, right: -0 });
  });
});

describe("joystick mapping", () => {
  it("returns neutral inside the radial deadzone", () => {
    const output = joystickToDrive(0.05, 0.05);
    // NOTE: the neutral outputs are -0 (the sign survives the -filtered.y
    // negation of a positive zero). Harmless downstream: -0 serializes as
    // "0" and compares == 0, but Object.is-level assertions must pin -0.
    expect(output.throttle).toBe(-0);
    expect(output.steering).toBe(-0);
  });

  it("maps stick up (dy = -1) to full forward throttle", () => {
    const output = joystickToDrive(0, -1);
    expect(output.throttle).toBe(1000);
    expect(output.steering).toBe(-0); // see NOTE above
  });

  it("maps stick right (dx = 1) to full negative steering (turn right)", () => {
    const output = joystickToDrive(1, 0);
    expect(output.steering).toBe(-1000);
    expect(output.throttle).toBe(-0); // see NOTE above
  });
});

describe("firmware parity (K_TURN 0.7, MAX_PWM 600)", () => {
  function previewPipeline(channelA: number, channelB: number, speedLimit: number): MotorPair {
    const mixed = mixDifferentialDrive(channelA, channelB, FIRMWARE_K_TURN);
    return applyOutputLimit(scaleDriveOutput(mixed, speedLimit), FIRMWARE_MAX_PWM);
  }

  it("matches hand-computed outputs for directional DRIVE commands", () => {
    const cases: Array<{ code: DirectionCode; expected: MotorPair }> = [
      // F: mix(1000, 0) = {1000, 1000}; x0.6 -> {600, 600}.
      { code: "F", expected: { left: 600, right: 600 } },
      // FL: mix(1000, 600) raw = {580, 1420}, peak 1420 -> {408, 1000};
      // x0.6 -> {245, 600} (244.8 rounds to 245).
      { code: "FL", expected: { left: 245, right: 600 } },
      // R pivot: mix(0, -1000) = {700, -700}; x0.6 -> {420, -420}.
      { code: "R", expected: { left: 420, right: -420 } },
    ];
    for (const { code, expected } of cases) {
      const command = createDirectionalDrive(code, 600);
      const output = previewPipeline(command.channelA, command.channelB, command.speedLimit);
      expect(output).toEqual(expected);
      expect(Math.max(Math.abs(output.left), Math.abs(output.right))).toBeLessThanOrEqual(
        FIRMWARE_MAX_PWM,
      );
    }
  });

  it("matches hand-computed output for half throttle", () => {
    // mix(500, 0) = {500, 500}; x0.6 -> {300, 300}.
    const command = createDriveCommand(500, 0, 600);
    expect(previewPipeline(command.channelA, command.channelB, command.speedLimit)).toEqual({
      left: 300,
      right: 300,
    });
  });

  it("never exceeds the firmware PWM ceiling across the full command envelope", () => {
    for (let throttle = -1000; throttle <= 1000; throttle += 250) {
      for (let steering = -1000; steering <= 1000; steering += 250) {
        const output = previewPipeline(throttle, steering, 1000);
        expect(Math.abs(output.left)).toBeLessThanOrEqual(FIRMWARE_MAX_PWM);
        expect(Math.abs(output.right)).toBeLessThanOrEqual(FIRMWARE_MAX_PWM);
      }
    }
  });
});
