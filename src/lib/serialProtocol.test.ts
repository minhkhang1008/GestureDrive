import { describe, expect, it } from "vitest";
import {
  COMMAND_FLAG,
  COMMAND_TYPE,
  createDirectPwmCommand,
  createDriveCommand,
  ESTOP_COMMAND,
  RESET_ESTOP_COMMAND,
  type ControlCommand,
} from "./controlTypes";
import {
  crc16Ccitt,
  isSequenceNewer,
  parseBridgeLine,
  serializeCommand,
} from "./serialProtocol";

describe("GD2 serial protocol", () => {
  it("implements CRC-16/CCITT-FALSE", () => {
    expect(crc16Ccitt("123456789")).toBe(0x29b1);
  });

  it("serializes all fields and a verifiable CRC", () => {
    const line = serializeCommand(createDriveCommand(750, -125, 600), 42);
    const trimmed = line.trim();
    const separator = trimmed.lastIndexOf(",");
    const body = trimmed.slice(0, separator);
    const crc = trimmed.slice(separator + 1);
    expect(body).toBe("GD2,42,1,750,-125,600,1");
    expect(Number.parseInt(crc, 16)).toBe(crc16Ccitt(body));
  });

  it("handles 16-bit sequence wrap and rejects duplicates", () => {
    expect(isSequenceNewer(0, 65535)).toBe(true);
    expect(isSequenceNewer(1, 65535)).toBe(true);
    expect(isSequenceNewer(65535, 0)).toBe(false);
    expect(isSequenceNewer(10, 10)).toBe(false);
  });

  it("pins the documented CRC vector and the exact wire line", () => {
    // Reference vector from the protocol docs: firmware and host must agree
    // on this byte-for-byte or every packet is rejected.
    expect(crc16Ccitt("GD2,42,1,750,-125,600,1")).toBe(0x4428);
    expect(serializeCommand(createDriveCommand(750, -125, 600), 42)).toBe(
      "GD2,42,1,750,-125,600,1,4428\n",
    );
  });

  it("always emits the GD2 line grammar, even for malformed input", () => {
    const grammar = /^GD2,\d+,[0-2],-?\d+,-?\d+,\d+,\d+,[0-9A-F]{4}\n$/;
    const malformed: ControlCommand = {
      type: COMMAND_TYPE.DRIVE,
      channelA: 5000.7,
      channelB: NaN,
      speedLimit: Infinity,
      flags: COMMAND_FLAG.ENABLE,
    };
    const cases: Array<[ControlCommand, number]> = [
      [createDriveCommand(750, -125, 600), 42],
      [createDriveCommand(-1000, 1000, 0), 0],
      [ESTOP_COMMAND, 65535],
      [RESET_ESTOP_COMMAND, 1],
      [createDirectPwmCommand(-300, 300, 500), 12345],
      [malformed, 99],
    ];
    for (const [command, sequence] of cases) {
      expect(serializeCommand(command, sequence)).toMatch(grammar);
    }
  });

  it("re-clamps fractional and out-of-range fields before framing", () => {
    const command: ControlCommand = {
      type: COMMAND_TYPE.DRIVE,
      channelA: 5000,
      channelB: 10.6,
      speedLimit: 2000,
      flags: COMMAND_FLAG.ENABLE,
    };
    const fields = serializeCommand(command, 7).trim().split(",");
    expect(fields[1]).toBe("7");
    expect(fields[3]).toBe("1000"); // 5000 clamped to CONTROL_MAX
    expect(fields[4]).toBe("11"); // 10.6 rounded to an integer
    expect(fields[5]).toBe("1000"); // 2000 clamped to the speed-limit ceiling
  });

  it("serializes non-finite fields as in-range integers", () => {
    // NOTE: clampInteger sends every non-finite value to the bound nearest
    // zero, so +Infinity and -Infinity both serialize as 0 (neutral), exactly
    // like NaN — never as full deflection.
    const command: ControlCommand = {
      type: COMMAND_TYPE.DRIVE,
      channelA: NaN,
      channelB: Infinity,
      speedLimit: -Infinity,
      flags: COMMAND_FLAG.ENABLE,
    };
    const fields = serializeCommand(command, 1).trim().split(",");
    expect(fields[3]).toBe("0"); // NaN channel -> 0
    expect(fields[4]).toBe("0");
    expect(fields[5]).toBe("0");
  });

  it("masks the sequence to 16 bits when framing", () => {
    const fields = serializeCommand(createDriveCommand(0, 0, 600), 65536 + 5)
      .trim()
      .split(",");
    expect(fields[1]).toBe("5");
  });

  it("pins the half-window and masking semantics of isSequenceNewer", () => {
    expect(isSequenceNewer(1, 0)).toBe(true);
    expect(isSequenceNewer(0, 0xffff)).toBe(true); // wrap-around still counts as newer
    expect(isSequenceNewer(7, 7)).toBe(false); // duplicates are never newer
    expect(isSequenceNewer(0x8000, 0)).toBe(false); // exactly half the window is "old"
    expect(isSequenceNewer(0x7fff, 0)).toBe(true); // just under half is "new"
    expect(isSequenceNewer((0x1234 + 0x8000) & 0xffff, 0x1234)).toBe(false);
    expect(isSequenceNewer(0x1234 + 0x7fff, 0x1234)).toBe(true);
    expect(isSequenceNewer(0x10001, 0)).toBe(true); // masked to 1
    expect(isSequenceNewer(0x10000, 0)).toBe(false); // masked to 0 == previous
  });

  it("parses link, timeout, radio and optional telemetry lines", () => {
    expect(parseBridgeLine("LINK:LORA")).toEqual({ kind: "link", value: "lora" });
    expect(parseBridgeLine("HOST_TIMEOUT:1")).toEqual({ kind: "host-timeout", value: true });
    expect(parseBridgeLine("RADIO_TX:65537")).toEqual({ kind: "radio-tx", sequence: 1 });
    expect(parseBridgeLine("HOST_ERROR:CRC")).toEqual({ kind: "host-error", code: "CRC" });
    expect(parseBridgeLine("TELEMETRY:8,-91.5,7.25,2,1,7400,120,-80,1")).toMatchObject({
      kind: "telemetry",
      value: {
        sequence: 8,
        rssi: -91.5,
        snr: 7.25,
        packetLoss: 2,
        failsafe: true,
        batteryMv: 7400,
        leftOutput: 120,
        rightOutput: -80,
        estop: true,
      },
    });
  });
});

describe("bridge line edge cases", () => {
  it("parses every non-telemetry line kind", () => {
    expect(parseBridgeLine("LINK:LORA")).toEqual({ kind: "link", value: "lora" });
    expect(parseBridgeLine("LINK:NONE")).toEqual({ kind: "link", value: "none" });
    expect(parseBridgeLine("HOST_TIMEOUT:1")).toEqual({ kind: "host-timeout", value: true });
    expect(parseBridgeLine("HOST_TIMEOUT:0")).toEqual({ kind: "host-timeout", value: false });
    expect(parseBridgeLine("RADIO_TX:12")).toEqual({ kind: "radio-tx", sequence: 12 });
    expect(parseBridgeLine("RADIO_ERROR:3")).toEqual({ kind: "radio-error", code: 3 });
    expect(parseBridgeLine("HOST_ERROR:BAD_CMD")).toEqual({ kind: "host-error", code: "BAD_CMD" });
  });

  it("parses six-field telemetry with nulls for the optional tail", () => {
    // Negative rssi and a negative snr float must parse as numbers.
    expect(parseBridgeLine("TELEMETRY:5,-88.5,-3.25,1,0,7100")).toEqual({
      kind: "telemetry",
      value: {
        sequence: 5,
        rssi: -88.5,
        snr: -3.25,
        packetLoss: 1,
        failsafe: false,
        batteryMv: 7100,
        leftOutput: null,
        rightOutput: null,
        estop: null,
        uplinkRssi: null,
        uplinkSnr: null,
        batteryLow: null,
        batteryCritical: null,
      },
    });
  });

  it("parses the full line: both link directions and the battery flags", () => {
    expect(
      parseBridgeLine("TELEMETRY:8,-91.5,7.25,2,0,7400,120,-80,0,-84.3,9.50,1,0"),
    ).toEqual({
      kind: "telemetry",
      value: {
        sequence: 8,
        // Downlink as the vehicle hears it, uplink as the station hears it:
        // a large gap between them means an asymmetric link, not a weak one.
        rssi: -91.5,
        snr: 7.25,
        uplinkRssi: -84.3,
        uplinkSnr: 9.5,
        packetLoss: 2,
        failsafe: false,
        batteryMv: 7400,
        batteryLow: true,
        batteryCritical: false,
        leftOutput: 120,
        rightOutput: -80,
        estop: false,
      },
    });
  });

  it("keeps the battery flags null when older firmware omits them", () => {
    expect(
      parseBridgeLine("TELEMETRY:8,-91.5,7.25,2,0,7400,120,-80,0"),
    ).toMatchObject({
      value: { uplinkRssi: null, uplinkSnr: null, batteryLow: null, batteryCritical: null },
    });
  });

  it("reports battery 0 as unknown (null), not 0 mV", () => {
    expect(parseBridgeLine("TELEMETRY:5,-88,4,0,0,0")).toMatchObject({
      kind: "telemetry",
      value: { batteryMv: null },
    });
  });

  it("decodes the ninth estop field: 1 true, 0 false, absent null", () => {
    expect(parseBridgeLine("TELEMETRY:8,-91.5,7.25,2,1,7400,120,-80,1")).toMatchObject({
      value: { estop: true },
    });
    expect(parseBridgeLine("TELEMETRY:8,-91.5,7.25,2,1,7400,120,-80,0")).toMatchObject({
      value: { estop: false },
    });
    expect(parseBridgeLine("TELEMETRY:8,-91.5,7.25,2,1,7400,120,-80")).toMatchObject({
      value: { estop: null, leftOutput: 120, rightOutput: -80 },
    });
  });

  it("rejects malformed telemetry as unknown", () => {
    expect(parseBridgeLine("TELEMETRY:1,abc,3,4,5,6")).toEqual({
      kind: "unknown",
      raw: "TELEMETRY:1,abc,3,4,5,6",
    });
    expect(parseBridgeLine("TELEMETRY:1,2,3")).toEqual({
      kind: "unknown",
      raw: "TELEMETRY:1,2,3",
    });
  });

  it("returns unknown for empty or garbage input", () => {
    expect(parseBridgeLine("")).toEqual({ kind: "unknown", raw: "" });
    expect(parseBridgeLine("  \r\n")).toEqual({ kind: "unknown", raw: "" });
    expect(parseBridgeLine("BOOTLOADER v1.2")).toEqual({
      kind: "unknown",
      raw: "BOOTLOADER v1.2",
    });
  });
});
