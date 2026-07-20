// The five characters the ESP32 firmware decodes over BluetoothSerial.
// Keep this file in sync with the AI team's gesture output and the ESP32 switch-case.
export type CommandCode = "F" | "B" | "L" | "R" | "S";

export type Direction = "up" | "down" | "left" | "right" | "stop";

export interface CommandDef {
  code: CommandCode;
  label: string; // Vietnamese, shown in UI
  english: string;
  gesture: string; // how the AI team's recognizer should trigger it
  motor: string; // what the ESP32 does
  direction: Direction;
}

export const COMMANDS: Record<CommandCode, CommandDef> = {
  F: {
    code: "F",
    label: "Tiến",
    english: "Forward",
    gesture: "Bàn tay xòe (5 ngón)",
    motor: "Hai động cơ quay tiến",
    direction: "up",
  },
  B: {
    code: "B",
    label: "Lùi",
    english: "Backward",
    gesture: "Bốn ngón (không ngón cái)",
    motor: "Hai động cơ quay lùi",
    direction: "down",
  },
  L: {
    code: "L",
    label: "Rẽ trái",
    english: "Left",
    gesture: "Ngón trỏ chỉ sang trái",
    motor: "Bánh phải tiến, bánh trái lùi",
    direction: "left",
  },
  R: {
    code: "R",
    label: "Rẽ phải",
    english: "Right",
    gesture: "Ngón trỏ chỉ sang phải",
    motor: "Bánh trái tiến, bánh phải lùi",
    direction: "right",
  },
  S: {
    code: "S",
    label: "Dừng",
    english: "Stop",
    gesture: "Nắm tay",
    motor: "Dừng cả hai động cơ",
    direction: "stop",
  },
};

export const COMMAND_ORDER: CommandCode[] = ["F", "B", "L", "R", "S"];
