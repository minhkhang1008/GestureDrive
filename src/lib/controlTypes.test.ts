import { describe, expect, it } from "vitest";
import {
  applyOutputLimit,
  mixDifferentialDrive,
  scaleDriveOutput,
} from "./driveMixer";
import {
  clampInteger,
  COMMAND_FLAG,
  COMMAND_TYPE,
  createDirectPwmCommand,
  createDriveCommand,
  createStopCommand,
  ESTOP_COMMAND,
  RESET_ESTOP_COMMAND,
  sameControlCommand,
  STOP_COMMAND,
} from "./controlTypes";
import { createDirectionalDrive } from "./commands";

describe("control command safety", () => {
  it("normalizes the differential mixer without exceeding 1000", () => {
    const mixed = mixDifferentialDrive(1000, 1000, 0.7);
    expect(mixed).toEqual({ left: 176, right: 1000 });
    expect(Math.max(Math.abs(mixed.left), Math.abs(mixed.right))).toBeLessThanOrEqual(1000);
  });

  it("limits mixed output after normalization", () => {
    expect(applyOutputLimit({ left: 900, right: -800 }, 600)).toEqual({
      left: 600,
      right: -600,
    });
  });

  it("scales DRIVE output by speedLimit", () => {
    expect(scaleDriveOutput({ left: 1000, right: -500 }, 600)).toEqual({
      left: 600,
      right: -300,
    });
  });

  it("maps left steering to left reverse and right forward", () => {
    const command = createDirectionalDrive("L", 600);
    const output = scaleDriveOutput(
      mixDifferentialDrive(command.channelA, command.channelB),
      command.speedLimit,
    );
    expect(output.left).toBeLessThan(0);
    expect(output.right).toBeGreaterThan(0);
  });

  it("never serializes DIRECT_PWM above its safety limit", () => {
    const command = createDirectPwmCommand(1000, -1000, 600);
    expect(command.type).toBe(COMMAND_TYPE.DIRECT_PWM);
    expect(command.channelA).toBe(600);
    expect(command.channelB).toBe(-600);
    expect(command.speedLimit).toBe(600);
  });

  it("keeps speed lock independent from STOP", () => {
    const drive = createDriveCommand(900, 0, 600, { speedLocked: true });
    expect(drive.flags & COMMAND_FLAG.SPEED_LOCKED).toBeTruthy();

    const stop = createStopCommand();
    expect(stop.type).toBe(COMMAND_TYPE.STOP);
    expect(stop.channelA).toBe(0);
    expect(stop.channelB).toBe(0);
    expect(stop.speedLimit).toBe(0);
    expect(stop.flags & COMMAND_FLAG.ENABLE).toBe(0);
  });

  it("forces STOP output to zero even for E-stop and reset packets", () => {
    expect(createStopCommand({ estop: true })).toMatchObject({
      channelA: 0,
      channelB: 0,
      speedLimit: 0,
    });
    expect(createStopCommand({ resetEstop: true })).toMatchObject({
      channelA: 0,
      channelB: 0,
      speedLimit: 0,
    });
  });
});

describe("STOP-family flag safety", () => {
  it("lets ESTOP win outright when estop and resetEstop are both requested", () => {
    const command = createStopCommand({ estop: true, resetEstop: true });
    expect(command.flags).toBe(COMMAND_FLAG.ESTOP);
    expect(command.flags & COMMAND_FLAG.RESET_ESTOP).toBe(0);
  });

  it("never carries ENABLE on the STOP-family constants", () => {
    for (const command of [STOP_COMMAND, ESTOP_COMMAND, RESET_ESTOP_COMMAND]) {
      expect(command.type).toBe(COMMAND_TYPE.STOP);
      expect(command.flags & COMMAND_FLAG.ENABLE).toBe(0);
    }
    expect(STOP_COMMAND.flags).toBe(0);
    expect(ESTOP_COMMAND.flags).toBe(COMMAND_FLAG.ESTOP);
    expect(RESET_ESTOP_COMMAND.flags).toBe(COMMAND_FLAG.RESET_ESTOP);
  });
});

describe("non-finite and fractional input clamping", () => {
  it("neutralizes a fully non-finite drive request", () => {
    expect(createDriveCommand(NaN, NaN, NaN)).toMatchObject({
      channelA: 0,
      channelB: 0,
      speedLimit: 0,
    });
  });

  it("snaps infinite throttle to neutral, not to full deflection", () => {
    // NOTE: clampInteger deliberately sends EVERY non-finite value (NaN and
    // both infinities) to the bound nearest zero, so +Infinity throttle
    // becomes 0, not 1000, and -Infinity becomes 0, not -1000. A corrupted
    // upstream computation therefore stops the vehicle instead of commanding
    // full speed. This test pins that safety choice.
    expect(createDriveCommand(Infinity, 0, 600).channelA).toBe(0);
    expect(createDriveCommand(-Infinity, 0, 600).channelA).toBe(0);
    expect(createDriveCommand(0, Infinity, 600).channelB).toBe(0);
  });

  it("clamps DIRECT_PWM channels to the already-clamped speed limit", () => {
    // Limit itself is clamped first (2000 -> 1000), then channels to +/-limit.
    expect(createDirectPwmCommand(900, -900, 2000)).toMatchObject({
      channelA: 900,
      channelB: -900,
      speedLimit: 1000,
    });
    expect(createDirectPwmCommand(500, -500, 300)).toMatchObject({
      channelA: 300,
      channelB: -300,
      speedLimit: 300,
    });
    // A negative limit clamps to 0, which forces both channels to 0.
    // NOTE: the reverse channel comes out as -0 (clamping a negative value
    // into the [-0, 0] range keeps the negative zero). String(-0) is "0" so
    // the wire format is unaffected; this pins the exact runtime value.
    expect(createDirectPwmCommand(500, -500, -50)).toMatchObject({
      channelA: 0,
      channelB: -0,
      speedLimit: 0,
    });
    expect(createDirectPwmCommand(NaN, 250.4, 300)).toMatchObject({
      channelA: 0,
      channelB: 250,
    });
  });
});

describe("clampInteger", () => {
  it("rounds with Math.round half-toward-positive-infinity semantics", () => {
    expect(clampInteger(0.5, -1000, 1000)).toBe(1);
    expect(clampInteger(2.5, -1000, 1000)).toBe(3);
    expect(clampInteger(-1.5, -1000, 1000)).toBe(-1); // halves round toward +Infinity
    // NOTE: Math.round(-0.5) is -0. Object.is-level -0 leaks out of
    // clampInteger, but String(-0) === "0" so the serialized wire format is
    // unaffected.
    expect(clampInteger(-0.5, -1000, 1000)).toBe(-0);
    expect(clampInteger(10.4, -1000, 1000)).toBe(10);
  });

  it("sends non-finite input to the bound nearest zero", () => {
    expect(clampInteger(NaN, 100, 200)).toBe(100);
    expect(clampInteger(NaN, -200, -100)).toBe(-100);
    expect(clampInteger(Infinity, 100, 200)).toBe(100);
    expect(clampInteger(-Infinity, 100, 200)).toBe(100);
    expect(clampInteger(NaN, -1000, 1000)).toBe(0);
    expect(clampInteger(Infinity, -1000, 1000)).toBe(0);
  });
});

describe("sameControlCommand", () => {
  it("compares structurally across all five fields", () => {
    const base = createDriveCommand(100, -100, 600);
    expect(sameControlCommand(base, { ...base })).toBe(true);
    expect(sameControlCommand(base, { ...base, type: COMMAND_TYPE.DIRECT_PWM })).toBe(false);
    expect(sameControlCommand(base, { ...base, channelA: 101 })).toBe(false);
    expect(sameControlCommand(base, { ...base, channelB: 100 })).toBe(false);
    expect(sameControlCommand(base, { ...base, speedLimit: 500 })).toBe(false);
    expect(sameControlCommand(base, { ...base, flags: base.flags | COMMAND_FLAG.ESTOP })).toBe(false);
  });

  it("treats null as equal only to null", () => {
    expect(sameControlCommand(null, null)).toBe(true);
    expect(sameControlCommand(null, STOP_COMMAND)).toBe(false);
    expect(sameControlCommand(STOP_COMMAND, null)).toBe(false);
  });
});
