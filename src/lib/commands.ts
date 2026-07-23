import {
  createDriveCommand,
  createStopCommand,
  type ControlCommand,
} from "./controlTypes";

export type DirectionCode =
  | "F"
  | "B"
  | "L"
  | "R"
  | "FL"
  | "FR"
  | "BL"
  | "BR"
  | "S";

export type Direction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right"
  | "stop";

export interface CommandDef {
  code: DirectionCode;
  label: string;
  english: string;
  control: string;
  direction: Direction;
}

export const COMMANDS: Record<DirectionCode, CommandDef> = {
  F: { code: "F", label: "Đi thẳng", english: "Forward", control: "Throttle +100%", direction: "up" },
  B: { code: "B", label: "Đi lùi", english: "Backward", control: "Throttle -100%", direction: "down" },
  L: { code: "L", label: "Pivot trái", english: "Pivot left", control: "Steering +100%", direction: "left" },
  R: { code: "R", label: "Pivot phải", english: "Pivot right", control: "Steering -100%", direction: "right" },
  FL: { code: "FL", label: "Tiến trái", english: "Forward left", control: "Throttle +100%, steering +60%", direction: "up-left" },
  FR: { code: "FR", label: "Tiến phải", english: "Forward right", control: "Throttle +100%, steering -60%", direction: "up-right" },
  BL: { code: "BL", label: "Lùi trái", english: "Backward left", control: "Throttle -100%, steering +60%", direction: "down-left" },
  BR: { code: "BR", label: "Lùi phải", english: "Backward right", control: "Throttle -100%, steering -60%", direction: "down-right" },
  S: { code: "S", label: "Dừng", english: "Stop", control: "Throttle 0%, steering 0%", direction: "stop" },
};

export const COMMAND_ORDER: DirectionCode[] = ["FL", "F", "FR", "L", "S", "R", "BL", "B", "BR"];

const DIRECTION_CHANNELS: Record<DirectionCode, [number, number]> = {
  S: [0, 0],
  F: [1000, 0],
  B: [-1000, 0],
  L: [0, 1000],
  R: [0, -1000],
  FL: [1000, 600],
  FR: [1000, -600],
  BL: [-1000, 600],
  BR: [-1000, -600],
};

export function createDirectionalDrive(
  code: DirectionCode,
  speedLimit: number,
  speedLocked = true,
): ControlCommand {
  if (code === "S") return createStopCommand();
  const [throttle, steering] = DIRECTION_CHANNELS[code];
  return createDriveCommand(throttle, steering, speedLimit, { speedLocked });
}
