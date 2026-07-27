import { useCallback, useEffect, useRef, useState } from "react";
import { STOP_COMMAND, type ControlCommand } from "../lib/controlTypes";
import {
  parseBridgeLine,
  serializeCommand,
  type Telemetry,
} from "../lib/serialProtocol";

export type LinkStatus = "disconnected" | "connecting" | "connected" | "error";
export type WirelessTransport = "unknown" | "lora" | "none";

export interface BridgeState {
  hostTimeout: boolean;
  lastRadioSequence: number | null;
  radioError: number | null;
  hostError: string | null;
  telemetry: Telemetry | null;
  /** performance.now() when the last TELEMETRY line arrived. */
  telemetryReceivedAt: number | null;
}

export interface SerialLink {
  status: LinkStatus;
  transport: WirelessTransport;
  portName: string | null;
  error: string | null;
  supported: boolean;
  lastSentSequence: number | null;
  bridge: BridgeState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (command: ControlCommand) => Promise<number | null>;
}

const BAUD_RATE = 115200;
/** A serial write slower than this means the port is wedged, not busy. */
const WRITE_TIMEOUT_MS = 300;
/** Newline-free garbage larger than this is dropped instead of buffered. */
const READ_BUFFER_LIMIT = 4096;

const INITIAL_BRIDGE_STATE: BridgeState = {
  hostTimeout: false,
  lastRadioSequence: null,
  radioError: null,
  hostError: null,
  telemetry: null,
  telemetryReceivedAt: null,
};

interface PendingWrite {
  payload: Uint8Array;
  sequence: number;
  resolve: (sequence: number | null) => void;
}

export function useSerialConnection(): SerialLink {
  const [status, setStatus] = useState<LinkStatus>("disconnected");
  const [transport, setTransport] = useState<WirelessTransport>("unknown");
  const [portName, setPortName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSentSequence, setLastSentSequence] = useState<number | null>(null);
  const [bridge, setBridge] = useState<BridgeState>(INITIAL_BRIDGE_STATE);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const sequenceRef = useRef(0);
  const closingRef = useRef(false);
  const connectingRef = useRef(false);
  const epochRef = useRef(0);
  // Latest-wins TX: one write in flight, one replaceable pending slot. The 20
  // Hz heartbeat plus gesture updates coalesce naturally, and a wedged port
  // can never grow an unbounded queue of stale movement commands.
  const writeInFlightRef = useRef(false);
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const disconnectHandlerRef = useRef<(() => void) | null>(null);
  const encoderRef = useRef(new TextEncoder());
  const lastSentUiUpdateRef = useRef(0);

  const supported = typeof navigator !== "undefined" && Boolean(navigator.serial);

  const handleBridgeLine = useCallback((line: string) => {
    const event = parseBridgeLine(line);
    if (event.kind === "link") {
      setTransport(event.value);
      return;
    }
    if (event.kind === "host-timeout") {
      setBridge((current) => ({
        ...current,
        hostTimeout: event.value,
        hostError: event.value ? current.hostError : null,
      }));
      return;
    }
    if (event.kind === "radio-tx") {
      setTransport("lora");
      setBridge((current) => ({
        ...current,
        lastRadioSequence: event.sequence,
        radioError: null,
      }));
      return;
    }
    if (event.kind === "radio-error") {
      setBridge((current) => ({ ...current, radioError: event.code }));
      return;
    }
    if (event.kind === "host-error") {
      setBridge((current) => ({ ...current, hostError: event.code }));
      return;
    }
    if (event.kind === "telemetry") {
      setBridge((current) => ({
        ...current,
        telemetry: event.value,
        telemetryReceivedAt: performance.now(),
      }));
    }
  }, []);

  const cleanup = useCallback(async (epoch: number) => {
    if (epoch !== epochRef.current) return;
    closingRef.current = true;

    const port = portRef.current;
    const handler = disconnectHandlerRef.current;
    if (port && handler) port.removeEventListener("disconnect", handler);
    disconnectHandlerRef.current = null;

    const pending = pendingWriteRef.current;
    pendingWriteRef.current = null;
    pending?.resolve(null);

    try {
      await readerRef.current?.cancel();
    } catch {
      // A physical disconnect may already have closed the reader.
    }
    try {
      readerRef.current?.releaseLock();
    } catch {
      // The read loop may have released the lock first.
    }
    readerRef.current = null;
    try {
      writerRef.current?.releaseLock();
    } catch {
      // The operating system may already have released the writer.
    }
    writerRef.current = null;
    try {
      await port?.close();
    } catch {
      // Ignore close errors after unplugging the USB cable.
    }
    if (epoch === epochRef.current) {
      portRef.current = null;
      closingRef.current = false;
    }
  }, []);

  const failLink = useCallback(
    (reason: unknown) => {
      if (closingRef.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("error");
      void cleanup(epochRef.current);
    },
    [cleanup],
  );

  const readBridge = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          if (buffer.length > READ_BUFFER_LIMIT) buffer = "";
          lines.forEach(handleBridgeLine);
        }
      } catch (reason) {
        failLink(reason);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // cleanup() may have released the reader first.
        }
        if (readerRef.current === reader) readerRef.current = null;
      }
    },
    [failLink, handleBridgeLine],
  );

  const pumpWrites = useCallback(() => {
    if (writeInFlightRef.current) return;
    const pending = pendingWriteRef.current;
    if (!pending) return;
    pendingWriteRef.current = null;

    const writer = writerRef.current;
    if (!writer || closingRef.current) {
      pending.resolve(null);
      return;
    }

    writeInFlightRef.current = true;
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      writeInFlightRef.current = false;
      pending.resolve(null);
      failLink(new Error(`Ghi serial quá ${WRITE_TIMEOUT_MS} ms — cổng bị kẹt.`));
    }, WRITE_TIMEOUT_MS);

    writer.write(pending.payload).then(
      () => {
        window.clearTimeout(timeout);
        if (settled) return;
        settled = true;
        writeInFlightRef.current = false;

        const now = performance.now();
        // Serial vẫn gửi 20 Hz nhưng UI chỉ render lại tối đa 4 Hz.
        if (now - lastSentUiUpdateRef.current >= 250) {
          lastSentUiUpdateRef.current = now;
          setLastSentSequence(pending.sequence);
        }
        pending.resolve(pending.sequence);
        pumpWrites();
      },
      (reason) => {
        window.clearTimeout(timeout);
        if (settled) return;
        settled = true;
        writeInFlightRef.current = false;
        pending.resolve(null);
        failLink(reason);
      },
    );
  }, [failLink]);

  const writeCommand = useCallback(
    (command: ControlCommand): Promise<number | null> => {
      const sequence = (sequenceRef.current + 1) & 0xffff;
      sequenceRef.current = sequence;
      const payload = encoderRef.current.encode(serializeCommand(command, sequence));

      return new Promise((resolve) => {
        const superseded = pendingWriteRef.current;
        pendingWriteRef.current = { payload, sequence, resolve };
        superseded?.resolve(null);
        pumpWrites();
      });
    },
    [pumpWrites],
  );

  const connect = useCallback(async () => {
    if (!navigator.serial) {
      setError("Web Serial không được hỗ trợ. Hãy dùng Chrome hoặc Edge desktop.");
      setStatus("error");
      return;
    }
    if (connectingRef.current) return;
    connectingRef.current = true;

    try {
      // A previous half-open connection must be fully released first.
      if (portRef.current) await cleanup(epochRef.current);

      setError(null);
      setTransport("unknown");
      setBridge(INITIAL_BRIDGE_STATE);
      setStatus("connecting");

      const epoch = epochRef.current + 1;
      epochRef.current = epoch;
      closingRef.current = false;

      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      const writer = port.writable?.getWriter();
      const reader = port.readable?.getReader();
      if (!writer || !reader) throw new Error("Cổng serial không hỗ trợ đọc và ghi.");

      portRef.current = port;
      writerRef.current = writer;
      readerRef.current = reader;
      sequenceRef.current = 0;
      writeInFlightRef.current = false;
      pendingWriteRef.current = null;
      lastSentUiUpdateRef.current = 0;
      setLastSentSequence(null);
      const info = port.getInfo();
      setPortName(
        info.usbVendorId
          ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`
          : "ESP1",
      );

      const onDisconnect = () => {
        setStatus("disconnected");
        setTransport("unknown");
        setPortName(null);
        void cleanup(epoch);
      };
      disconnectHandlerRef.current = onDisconnect;
      port.addEventListener("disconnect", onDisconnect);
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
      await cleanup(epochRef.current);
    } finally {
      connectingRef.current = false;
    }
  }, [cleanup, readBridge]);

  const disconnect = useCallback(async () => {
    // Stop accepting new writes, then make STOP the final line on the wire
    // before releasing the port.
    closingRef.current = true;
    const superseded = pendingWriteRef.current;
    pendingWriteRef.current = null;
    superseded?.resolve(null);

    const writer = writerRef.current;
    if (writer) {
      const sequence = (sequenceRef.current + 1) & 0xffff;
      sequenceRef.current = sequence;
      try {
        await writer.write(
          encoderRef.current.encode(serializeCommand(STOP_COMMAND, sequence)),
        );
        setLastSentSequence(sequence);
      } catch {
        // A physical unplug can make the best-effort final STOP impossible.
      }
    }
    await cleanup(epochRef.current);
    setStatus("disconnected");
    setTransport("unknown");
    setPortName(null);
  }, [cleanup]);

  useEffect(() => {
    return () => {
      void cleanup(epochRef.current);
    };
  }, [cleanup]);

  return {
    status,
    transport,
    portName,
    error,
    supported,
    lastSentSequence,
    bridge,
    connect,
    disconnect,
    send: writeCommand,
  };
}
