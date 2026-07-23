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
const INITIAL_BRIDGE_STATE: BridgeState = {
  hostTimeout: false,
  lastRadioSequence: null,
  radioError: null,
  hostError: null,
  telemetry: null,
};

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
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
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
      setBridge((current) => ({ ...current, telemetry: event.value }));
    }
  }, []);

  const cleanup = useCallback(async () => {
    closingRef.current = true;
    const port = portRef.current;
    const handler = disconnectHandlerRef.current;
    if (port && handler) port.removeEventListener("disconnect", handler);
    disconnectHandlerRef.current = null;

    await writeQueueRef.current.catch(() => undefined);
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
    portRef.current = null;
    closingRef.current = false;
  }, []);

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
          // cleanup() may have released the reader first.
        }
        if (readerRef.current === reader) readerRef.current = null;
      }
    },
    [handleBridgeLine],
  );

  const writeCommand = useCallback(
    (command: ControlCommand): Promise<number | null> => {
      const sequence = (sequenceRef.current + 1) & 0xffff;
      sequenceRef.current = sequence;
      const payload = encoderRef.current.encode(serializeCommand(command, sequence));

      return new Promise((resolve) => {
        writeQueueRef.current = writeQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            const writer = writerRef.current;
            if (!writer || closingRef.current) {
              resolve(null);
              return;
            }
            try {
              await writer.write(payload);

              const now = performance.now();

              // Serial vẫn gửi 20 Hz nhưng UI chỉ render lại tối đa 4 Hz.
              if (now - lastSentUiUpdateRef.current >= 250) {
                lastSentUiUpdateRef.current = now;
                setLastSentSequence(sequence);
              }

              resolve(sequence);
            } catch (reason) {
              if (!closingRef.current) {
                setError(reason instanceof Error ? reason.message : String(reason));
                setStatus("error");
              }
              resolve(null);
            }
          });
      });
    },
    [],
  );

  const connect = useCallback(async () => {
    if (!navigator.serial) {
      setError("Web Serial không được hỗ trợ. Hãy dùng Chrome hoặc Edge desktop.");
      setStatus("error");
      return;
    }
    setError(null);
    setTransport("unknown");
    setBridge(INITIAL_BRIDGE_STATE);
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
        void cleanup();
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
      await cleanup();
    }
  }, [cleanup, readBridge]);

  const disconnect = useCallback(async () => {
    // Stop accepting queued heartbeats, let already queued writes drain/skip,
    // then make STOP the final write before releasing the port.
    closingRef.current = true;
    await writeQueueRef.current.catch(() => undefined);
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
    await cleanup();
    setStatus("disconnected");
    setTransport("unknown");
    setPortName(null);
  }, [cleanup]);

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
    lastSentSequence,
    bridge,
    connect,
    disconnect,
    send: writeCommand,
  };
}
