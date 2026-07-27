import {
  clampControl,
  clampSpeedLimit,
  type ControlCommand,
} from "./controlTypes";

const encoder = new TextEncoder();

export interface Telemetry {
  sequence: number;
  /** Downlink (station -> vehicle), measured by ESP2 on the control packet. */
  rssi: number;
  snr: number;
  /** Uplink (vehicle -> station), measured by ESP1 on the telemetry reply. */
  uplinkRssi: number | null;
  uplinkSnr: number | null;
  packetLoss: number;
  failsafe: boolean;
  batteryMv: number | null;
  /** Pack below the warning threshold; the vehicle still drives. */
  batteryLow: boolean | null;
  /** Under-voltage lockout latched on the vehicle: motors are cut. */
  batteryCritical: boolean | null;
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
  // Defense in depth: an out-of-range or fractional field would poison every
  // heartbeat line, so the serializer re-clamps instead of trusting callers.
  const body = [
    "GD2",
    sequence & 0xffff,
    command.type,
    clampControl(command.channelA),
    clampControl(command.channelB),
    clampSpeedLimit(command.speedLimit),
    command.flags & 0xff,
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
      // Fields beyond the first six were added over time; a shorter line from
      // older ESP1 firmware still parses, with the extras reported as unknown.
      const optionalFlag = (value: number | null | undefined): boolean | null =>
        value === null || value === undefined ? null : value === 1;
      if (parsed.slice(0, 6).every((value) => value !== null)) {
        return {
          kind: "telemetry",
          value: {
            sequence: (parsed[0] ?? 0) & 0xffff,
            rssi: parsed[1] ?? 0,
            snr: parsed[2] ?? 0,
            packetLoss: parsed[3] ?? 0,
            failsafe: parsed[4] === 1,
            batteryMv: !parsed[5] ? null : parsed[5],
            leftOutput: parsed[6] ?? null,
            rightOutput: parsed[7] ?? null,
            estop: optionalFlag(parsed[8]),
            uplinkRssi: parsed[9] ?? null,
            uplinkSnr: parsed[10] ?? null,
            batteryLow: optionalFlag(parsed[11]),
            batteryCritical: optionalFlag(parsed[12]),
          },
        };
      }
    }
  }
  return { kind: "unknown", raw: line };
}
