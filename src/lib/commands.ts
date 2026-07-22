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
  wireCode: number;
  label: string;
  english: string;
  motor: string;
  direction: Direction;
}

export interface DriveCommand {
  code: DirectionCode;
  speed: number;
  leftMotor: number;
  rightMotor: number;
  speedLocked: boolean;
}

export const COMMANDS: Record<DirectionCode, CommandDef> = {
  F: {
    code: "F",
    wireCode: 1,
    label: "Đi thẳng",
    english: "Forward",
    motor: "Hai bánh tiến đều",
    direction: "up",
  },
  B: {
    code: "B",
    wireCode: 2,
    label: "Đi lùi",
    english: "Backward",
    motor: "Hai bánh lùi đều",
    direction: "down",
  },
  L: {
    code: "L",
    wireCode: 3,
    label: "Quay trái",
    english: "Pivot left",
    motor: "Bánh trái lùi, bánh phải tiến",
    direction: "left",
  },
  R: {
    code: "R",
    wireCode: 4,
    label: "Quay phải",
    english: "Pivot right",
    motor: "Bánh trái tiến, bánh phải lùi",
    direction: "right",
  },
  FL: {
    code: "FL",
    wireCode: 5,
    label: "Chếch trái",
    english: "Forward left",
    motor: "Bánh trái chậm, bánh phải nhanh",
    direction: "up-left",
  },
  FR: {
    code: "FR",
    wireCode: 6,
    label: "Chếch phải",
    english: "Forward right",
    motor: "Bánh trái nhanh, bánh phải chậm",
    direction: "up-right",
  },
  BL: {
    code: "BL",
    wireCode: 7,
    label: "Lùi chếch trái",
    english: "Backward left",
    motor: "Bánh trái lùi chậm, bánh phải lùi nhanh",
    direction: "down-left",
  },
  BR: {
    code: "BR",
    wireCode: 8,
    label: "Lùi chếch phải",
    english: "Backward right",
    motor: "Bánh trái lùi nhanh, bánh phải lùi chậm",
    direction: "down-right",
  },
  S: {
    code: "S",
    wireCode: 0,
    label: "Dừng",
    english: "Stop",
    motor: "Dừng cả hai động cơ",
    direction: "stop",
  },
};

export const COMMAND_ORDER: DirectionCode[] = [
  "FL",
  "F",
  "FR",
  "L",
  "S",
  "R",
  "BL",
  "B",
  "BR",
];

const TURN_RATIO = 0.45;

function clampPwm(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

export function createDriveCommand(
  code: DirectionCode,
  requestedSpeed: number,
  speedLocked: boolean,
): DriveCommand {
  const speed = clampPwm(requestedSpeed);
  const slow = Math.round(speed * TURN_RATIO);

  const motors: Record<DirectionCode, [number, number]> = {
    S: [0, 0],
    F: [speed, speed],
    B: [-speed, -speed],
    L: [-speed, speed],
    R: [speed, -speed],
    FL: [slow, speed],
    FR: [speed, slow],
    BL: [-slow, -speed],
    BR: [-speed, -slow],
  };

  const [leftMotor, rightMotor] = motors[code];
  return { code, speed, leftMotor, rightMotor, speedLocked };
}

export const STOP_COMMAND = createDriveCommand("S", 0, true);

export function sameDriveCommand(
  a: DriveCommand | null,
  b: DriveCommand | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.code === b.code &&
    a.speed === b.speed &&
    a.leftMotor === b.leftMotor &&
    a.rightMotor === b.rightMotor &&
    a.speedLocked === b.speedLocked
  );
}

/**
 * USB protocol from the browser to ESP1.
 *
 * GD,sequence,leftMotor,rightMotor,speed,direction,flags\n
 * flags bit 0: the speed slider is locked.
 */
export function toWireLine(command: DriveCommand, sequence: number): string {
  const flags = command.speedLocked ? 1 : 0;
  return [
    "GD",
    sequence & 0xffff,
    command.leftMotor,
    command.rightMotor,
    command.speed,
    COMMANDS[command.code].wireCode,
    flags,
  ].join(",") + "\n";
}
