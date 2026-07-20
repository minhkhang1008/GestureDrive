import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandCode } from "../lib/commands";

export type LinkStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "demo"
  | "error";

export interface SerialLink {
  status: LinkStatus;
  portName: string | null;
  error: string | null;
  supported: boolean;
  connect: () => Promise<void>;
  startDemo: () => void;
  disconnect: () => Promise<void>;
  send: (code: CommandCode) => Promise<void>;
}

const BAUD_RATE = 115200;

/**
 * Owns the link to the ESP32.
 *
 * Primary transport is the Web Serial API (Chrome / Edge on desktop). The
 * ESP32's BluetoothSerial is Bluetooth Classic (SPP): once the board is paired
 * with the computer it exposes a serial port that this opens, and a USB cable
 * exposes the same interface. Demo mode drives the whole UI without hardware
 * for rehearsing the presentation.
 */
export function useSerialConnection(): SerialLink {
  const [status, setStatus] = useState<LinkStatus>("disconnected");
  const [portName, setPortName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const encoderRef = useRef(new TextEncoder());

  const supported = typeof navigator !== "undefined" && !!navigator.serial;

  const cleanup = useCallback(async () => {
    try {
      writerRef.current?.releaseLock();
    } catch {
      /* already released */
    }
    writerRef.current = null;
    try {
      await portRef.current?.close();
    } catch {
      /* already closed */
    }
    portRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.serial) {
      setError("Trình duyệt không hỗ trợ Web Serial. Hãy dùng Chrome hoặc Edge.");
      setStatus("error");
      return;
    }
    setError(null);
    setStatus("connecting");
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      const writer = port.writable?.getWriter();
      if (!writer) throw new Error("Cổng không ghi được dữ liệu.");
      portRef.current = port;
      writerRef.current = writer;
      const info = port.getInfo();
      setPortName(
        info.usbVendorId
          ? `USB ${info.usbVendorId.toString(16)}:${info.usbProductId?.toString(16) ?? "----"}`
          : "ESP32 (Bluetooth SPP)",
      );
      port.addEventListener("disconnect", () => {
        setStatus("disconnected");
        setPortName(null);
        void cleanup();
      });
      setStatus("connected");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The user dismissing the port picker is not a real error.
      if (/No port selected|cancel/i.test(msg)) {
        setStatus("disconnected");
        return;
      }
      setError(msg);
      setStatus("error");
      await cleanup();
    }
  }, [cleanup]);

  const startDemo = useCallback(() => {
    setError(null);
    setPortName("Chế độ giả lập");
    setStatus("demo");
  }, []);

  const disconnect = useCallback(async () => {
    await cleanup();
    setStatus("disconnected");
    setPortName(null);
  }, [cleanup]);

  const send = useCallback(async (code: CommandCode) => {
    const writer = writerRef.current;
    if (!writer) return; // demo mode and disconnected are both no-ops on the wire
    try {
      await writer.write(encoderRef.current.encode(code));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  return { status, portName, error, supported, connect, startDemo, disconnect, send };
}
