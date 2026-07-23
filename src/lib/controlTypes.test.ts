import { describe, expect, it } from "vitest";
import {
  applyOutputLimit,
  mixDifferentialDrive,
  scaleDriveOutput,
} from "./driveMixer";
import {
  COMMAND_FLAG,
  COMMAND_TYPE,
  createDirectPwmCommand,
  createDriveCommand,
  createStopCommand,
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
