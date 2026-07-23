export const CONTROL_MIN = -1000;
export const CONTROL_MAX = 1000;
export const DEFAULT_SPEED_LIMIT = 600;

export const COMMAND_TYPE = {
  STOP: 0,
  DRIVE: 1,
  DIRECT_PWM: 2,
} as const;

export type CommandType = (typeof COMMAND_TYPE)[keyof typeof COMMAND_TYPE];

export const COMMAND_FLAG = {
  ENABLE: 1 << 0,
  ESTOP: 1 << 1,
  SPEED_LOCKED: 1 << 2,
  RESET_ESTOP: 1 << 3,
} as const;

export type ControlMode = "AUTO" | "MANUAL" | "CALIBRATION";

export interface ControlCommand {
  type: CommandType;
  channelA: number;
  channelB: number;
  speedLimit: number;
  flags: number;
}

export interface CommandOptions {
  speedLocked?: boolean;
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function clampControl(value: number): number {
  return clampInteger(value, CONTROL_MIN, CONTROL_MAX);
}

export function clampSpeedLimit(value: number): number {
  return clampInteger(value, 0, CONTROL_MAX);
}

export function createStopCommand(
  options: { estop?: boolean; resetEstop?: boolean } = {},
): ControlCommand {
  let flags = 0;
  if (options.estop) flags |= COMMAND_FLAG.ESTOP;
  if (options.resetEstop) flags |= COMMAND_FLAG.RESET_ESTOP;
  return {
    type: COMMAND_TYPE.STOP,
    channelA: 0,
    channelB: 0,
    speedLimit: 0,
    flags,
  };
}

export function createDriveCommand(
  throttle: number,
  steering: number,
  speedLimit: number,
  options: CommandOptions = {},
): ControlCommand {
  const flags =
    COMMAND_FLAG.ENABLE |
    (options.speedLocked ? COMMAND_FLAG.SPEED_LOCKED : 0);
  return {
    type: COMMAND_TYPE.DRIVE,
    channelA: clampControl(throttle),
    channelB: clampControl(steering),
    speedLimit: clampSpeedLimit(speedLimit),
    flags,
  };
}

export function createDirectPwmCommand(
  leftCommand: number,
  rightCommand: number,
  speedLimit: number,
): ControlCommand {
  const limit = clampSpeedLimit(speedLimit);
  return {
    type: COMMAND_TYPE.DIRECT_PWM,
    channelA: clampInteger(leftCommand, -limit, limit),
    channelB: clampInteger(rightCommand, -limit, limit),
    speedLimit: limit,
    flags: COMMAND_FLAG.ENABLE,
  };
}

export const STOP_COMMAND = createStopCommand();
export const ESTOP_COMMAND = createStopCommand({ estop: true });
export const RESET_ESTOP_COMMAND = createStopCommand({ resetEstop: true });

export function isStopCommand(command: ControlCommand): boolean {
  return (
    command.type === COMMAND_TYPE.STOP ||
    (command.channelA === 0 && command.channelB === 0)
  );
}

export function sameControlCommand(
  a: ControlCommand | null,
  b: ControlCommand | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.type === b.type &&
    a.channelA === b.channelA &&
    a.channelB === b.channelB &&
    a.speedLimit === b.speedLimit &&
    a.flags === b.flags
  );
}

export function commandTypeName(type: CommandType): keyof typeof COMMAND_TYPE {
  if (type === COMMAND_TYPE.DRIVE) return "DRIVE";
  if (type === COMMAND_TYPE.DIRECT_PWM) return "DIRECT_PWM";
  return "STOP";
}
