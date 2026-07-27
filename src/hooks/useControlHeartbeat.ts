import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { LinkStatus } from "./useSerialConnection";
import type { ControlCommand } from "../lib/controlTypes";

const CONTROL_INTERVAL_MS = 50;

// Browsers throttle main-thread timers in hidden tabs to ~1 Hz, which would
// starve ESP1's 225 ms host watchdog. Dedicated-worker timers are exempt from
// that throttling, so the 20 Hz heartbeat keeps flowing even when the operator
// alt-tabs away (App additionally forces STOP on visibility loss).
const TICKER_SOURCE = `
  let timer = null;
  onmessage = (event) => {
    if (event.data && event.data.type === "start") {
      clearInterval(timer);
      timer = setInterval(() => postMessage(0), event.data.intervalMs);
    } else {
      clearInterval(timer);
      timer = null;
    }
  };
`;

function createTickerWorker(): Worker | null {
  try {
    const blob = new Blob([TICKER_SOURCE], { type: "application/javascript" });
    return new Worker(URL.createObjectURL(blob));
  } catch {
    return null;
  }
}

export function useControlHeartbeat({
  command,
  linkStatus,
  send,
}: {
  command: ControlCommand;
  linkStatus: LinkStatus;
  send: (command: ControlCommand) => Promise<number | null>;
}) {
  const commandRef = useRef(command);

  useLayoutEffect(() => {
    commandRef.current = command;
  }, [command]);

  const setLatestCommand = useCallback((next: ControlCommand) => {
    commandRef.current = next;
  }, []);

  useEffect(() => {
    if (linkStatus !== "connected") return;
    void send(commandRef.current);

    const tick = () => {
      void send(commandRef.current);
    };

    const worker = createTickerWorker();
    if (worker) {
      worker.onmessage = tick;
      worker.postMessage({ type: "start", intervalMs: CONTROL_INTERVAL_MS });
      return () => {
        worker.postMessage({ type: "stop" });
        worker.terminate();
      };
    }

    const timer = window.setInterval(tick, CONTROL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [linkStatus, send]);

  return setLatestCommand;
}
