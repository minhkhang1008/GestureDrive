import { useCallback, useEffect, useRef, useState } from "react";
import {
  STOP_COMMAND,
  toWireLine,
  type DriveCommand,
} from "../lib/commands";

export type LinkStatus = "disconnected" | "connecting" | "connected" | "error";
export type WirelessTransport = "unknown" | "esp-now" | "bluetooth" | "none";

export interface SerialLink {
  status: LinkStatus;
  transport: WirelessTransport;
  portName: string | null;
  error: string | null;
  supported: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (command: DriveCommand) => Promise<boolean>;
}

const BAUD_RATE = 115200;

/**
 * USB link to ESP1. ESP1 reports which vehicle link is active using one of:
 * LINK:ESPNOW, LINK:BLUETOOTH, or LINK:NONE.
 */
export function useSerialConnection(): SerialLink {
  const [status, setStatus] = useState<LinkStatus>("disconnected");
  const [transport, setTransport] = useState<WirelessTransport>("unknown");
  const [portName, setPortName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const sequenceRef = useRef(0);
  const closingRef = useRef(false);
  const encoderRef = useRef(new TextEncoder());

  const supported = typeof navigator !== "undefined" && Boolean(navigator.serial);

  const handleBridgeLine = useCallback((line: string) => {
    const message = line.trim();
    if (message === "LINK:ESPNOW") setTransport("esp-now");
    if (message === "LINK:BLUETOOTH") setTransport("bluetooth");
    if (message === "LINK:NONE") setTransport("none");
    if (message.startsWith("ERROR:")) setError(message.slice(6).trim());
  }, []);

  const cleanup = useCallback(async () => {
    closingRef.current = true;
    try {
      await readerRef.current?.cancel();
    } catch {
      // Reader may already be closed by a physical disconnect.
    }
    try {
      readerRef.current?.releaseLock();
    } catch {
      // Lock may already be released by the read loop.
    }
    readerRef.current = null;
    try {
      writerRef.current?.releaseLock();
    } catch {
      // Writer may already be released.
    }
    writerRef.current = null;
    try {
      await portRef.current?.close();
    } catch {
      // The operating system may already have closed the port.
    }
    portRef.current = null;
    closingRef.current = false;
  }, []);

  const readBridge = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        lines.forEach(handleBridgeLine);
      }
    } catch (reason) {
      if (!closingRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // cleanup() may have released it first.
      }
      if (readerRef.current === reader) readerRef.current = null;
    }
  }, [handleBridgeLine]);

  const connect = useCallback(async () => {
    if (!navigator.serial) {
      setError("Trình duyệt không hỗ trợ Web Serial. Hãy dùng Chrome hoặc Edge.");
      setStatus("error");
      return;
    }
    setError(null);
    setTransport("unknown");
    setStatus("connecting");
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      const writer = port.writable?.getWriter();
      const reader = port.readable?.getReader();
      if (!writer || !reader) throw new Error("Cổng serial không hỗ trợ đọc và ghi.");

      portRef.current = port;
      writerRef.current = writer;
      readerRef.current = reader;
      sequenceRef.current = 0;
      const info = port.getInfo();
      setPortName(
        info.usbVendorId
          ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`
          : "ESP1",
      );
      port.addEventListener("disconnect", () => {
        setStatus("disconnected");
        setTransport("unknown");
        setPortName(null);
        void cleanup();
      });
      setStatus("connected");
      void readBridge(reader);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (/No port selected|cancel/i.test(message)) {
        setStatus("disconnected");
        return;
      }
      setError(message);
      setStatus("error");
      await cleanup();
    }
  }, [cleanup, readBridge]);

  const writeCommand = useCallback(async (command: DriveCommand): Promise<boolean> => {
    const writer = writerRef.current;
    if (!writer) return false;
    sequenceRef.current = (sequenceRef.current + 1) & 0xffff;
    try {
      await writer.write(
        encoderRef.current.encode(toWireLine(command, sequenceRef.current)),
      );
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("error");
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (writerRef.current) await writeCommand(STOP_COMMAND);
    await cleanup();
    setStatus("disconnected");
    setTransport("unknown");
    setPortName(null);
  }, [cleanup, writeCommand]);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  return {
    status,
    transport,
    portName,
    error,
    supported,
    connect,
    disconnect,
    send: writeCommand,
  };
}
