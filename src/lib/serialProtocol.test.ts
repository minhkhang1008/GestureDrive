import { describe, expect, it } from "vitest";
import { createDriveCommand } from "./controlTypes";
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
