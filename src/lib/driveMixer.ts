import { clamp, applyRadialDeadzone } from "./filters";

// Mirrors firmware/common/ConfigDefaults.h — keep in sync manually so the UI
// output preview matches what ESP2 actually drives.
export const FIRMWARE_MAX_PWM = 600;
export const FIRMWARE_K_TURN = 0.7;

export interface MotorPair {
  left: number;
  right: number;
}

export function mixDifferentialDrive(
  throttle: number,
  steering: number,
  turnGain = 0.7,
): MotorPair {
  const boundedThrottle = clamp(throttle, -1000, 1000);
  const boundedSteering = clamp(steering, -1000, 1000);
  let left = boundedThrottle - turnGain * boundedSteering;
  let right = boundedThrottle + turnGain * boundedSteering;
  const peak = Math.max(1000, Math.abs(left), Math.abs(right));
  left = (left / peak) * 1000;
  right = (right / peak) * 1000;
  return { left: Math.round(left), right: Math.round(right) };
}

export function joystickToDrive(
  dx: number,
  dy: number,
  deadzone = 0.1,
): { throttle: number; steering: number } {
  const filtered = applyRadialDeadzone(dx, dy, deadzone);
  return {
    throttle: Math.round(clamp(-filtered.y, -1, 1) * 1000),
    steering: Math.round(clamp(-filtered.x, -1, 1) * 1000),
  };
}

export function applyOutputLimit(pair: MotorPair, speedLimit: number): MotorPair {
  const limit = Math.round(clamp(speedLimit, 0, 1000));
  return {
    left: Math.round(clamp(pair.left, -limit, limit)),
    right: Math.round(clamp(pair.right, -limit, limit)),
  };
}

export function scaleDriveOutput(pair: MotorPair, speedLimit: number): MotorPair {
  const scale = clamp(speedLimit, 0, 1000) / 1000;
  return {
    left: Math.round(pair.left * scale),
    right: Math.round(pair.right * scale),
  };
}
