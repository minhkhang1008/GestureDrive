import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { LinkStatus } from "./useSerialConnection";
import type { ControlCommand } from "../lib/controlTypes";

const CONTROL_INTERVAL_MS = 50;

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
    const timer = window.setInterval(() => {
      void send(commandRef.current);
    }, CONTROL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [linkStatus, send]);

  return setLatestCommand;
}
