import type { ControlCommand } from "./controlTypes";

const encoder = new TextEncoder();

export interface Telemetry {
  sequence: number;
  rssi: number;
  snr: number;
  packetLoss: number;
  failsafe: boolean;
  batteryMv: number | null;
  leftOutput: number | null;
  rightOutput: number | null;
  estop: boolean | null;
}

export type BridgeEvent =
  | { kind: "link"; value: "lora" | "none" }
  | { kind: "host-timeout"; value: boolean }
  | { kind: "radio-tx"; sequence: number }
  | { kind: "radio-error"; code: number }
  | { kind: "host-error"; code: string }
  | { kind: "telemetry"; value: Telemetry }
  | { kind: "unknown"; raw: string };

export function crc16Ccitt(data: Uint8Array | string): number {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function serializeCommand(command: ControlCommand, sequence: number): string {
  const body = [
    "GD2",
    sequence & 0xffff,
    command.type,
    command.channelA,
    command.channelB,
    command.speedLimit,
    command.flags,
  ].join(",");
  const crc = crc16Ccitt(body).toString(16).toUpperCase().padStart(4, "0");
  return `${body},${crc}\n`;
}

export function isSequenceNewer(candidate: number, previous: number): boolean {
  const difference = ((candidate & 0xffff) - (previous & 0xffff)) & 0xffff;
  return difference !== 0 && difference < 0x8000;
}

function finiteNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBridgeLine(input: string): BridgeEvent {
  const line = input.trim();
  if (line === "LINK:LORA") return { kind: "link", value: "lora" };
  if (line === "LINK:NONE") return { kind: "link", value: "none" };
  if (line === "HOST_TIMEOUT:1") return { kind: "host-timeout", value: true };
  if (line === "HOST_TIMEOUT:0") return { kind: "host-timeout", value: false };

  if (line.startsWith("RADIO_TX:")) {
    const sequence = finiteNumber(line.slice("RADIO_TX:".length));
    if (sequence !== null) return { kind: "radio-tx", sequence: sequence & 0xffff };
  }
  if (line.startsWith("RADIO_ERROR:")) {
    const code = finiteNumber(line.slice("RADIO_ERROR:".length));
    if (code !== null) return { kind: "radio-error", code };
  }
  if (line.startsWith("HOST_ERROR:")) {
    return { kind: "host-error", code: line.slice("HOST_ERROR:".length) };
  }
  if (line.startsWith("TELEMETRY:")) {
    const values = line.slice("TELEMETRY:".length).split(",");
    if (values.length >= 6) {
      const parsed = values.map(finiteNumber);
      if (parsed.slice(0, 6).every((value) => value !== null)) {
        return {
          kind: "telemetry",
          value: {
            sequence: (parsed[0] ?? 0) & 0xffff,
            rssi: parsed[1] ?? 0,
            snr: parsed[2] ?? 0,
            packetLoss: parsed[3] ?? 0,
            failsafe: parsed[4] === 1,
            batteryMv: parsed[5] === 0 ? null : parsed[5],
            leftOutput: parsed[6] ?? null,
            rightOutput: parsed[7] ?? null,
            estop: parsed[8] === null || parsed[8] === undefined ? null : parsed[8] === 1,
          },
        };
      }
    }
  }
  return { kind: "unknown", raw: line };
}
