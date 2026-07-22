import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { CameraPanel } from "./components/CameraPanel";
import { CurrentCommand } from "./components/CurrentCommand";
import { ManualPad } from "./components/ManualPad";
import { GestureLegend } from "./components/GestureLegend";
import { CommandLog, type LogEntry } from "./components/CommandLog";
import type { Mode } from "./components/ModeToggle";
import { useSerialConnection } from "./hooks/useSerialConnection";
import { useHandTracking } from "./hooks/useHandTracking";
import {
  createDriveCommand,
  sameDriveCommand,
  STOP_COMMAND,
  type DirectionCode,
  type DriveCommand,
} from "./lib/commands";

const KEY_MAP: Record<string, DirectionCode> = {
  w: "F",
  s: "B",
  a: "L",
  d: "R",
  " ": "S",
};

const HEARTBEAT_MS = 200;
const HAND_LOSS_STOP_MS = 300;

function clock(): string {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

export default function App() {
  const link = useSerialConnection();
  const { send: sendToBridge, status: linkStatus } = link;
  const [mode, setMode] = useState<Mode>("AUTO");
  const [current, setCurrent] = useState<DriveCommand | null>(null);
  const [previous, setPrevious] = useState<DriveCommand | null>(null);
  const [manualSpeed, setManualSpeed] = useState(160);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pulseKey, setPulseKey] = useState(0);

  const currentRef = useRef<DriveCommand | null>(null);
  const modeRef = useRef<Mode>(mode);
  const manualSpeedRef = useRef(manualSpeed);
  const logId = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    manualSpeedRef.current = manualSpeed;
  }, [manualSpeed]);

  const dispatch = useCallback(
    (command: DriveCommand, source: "gesture" | "manual") => {
      if (sameDriveCommand(currentRef.current, command)) return;
      void sendToBridge(command);
      setPrevious(currentRef.current);
      currentRef.current = command;
      setCurrent(command);
      setPulseKey((key) => key + 1);
      logId.current += 1;
      const entry: LogEntry = {
        id: logId.current,
        command,
        time: clock(),
        source,
      };
      setLog((entries) => [entry, ...entries].slice(0, 40));
    },
    [sendToBridge],
  );

  const onControlUpdate = useCallback(
    (command: DriveCommand) => {
      if (modeRef.current !== "AUTO") return;
      dispatch(command, "gesture");
    },
    [dispatch],
  );

  const tracking = useHandTracking({ onControlUpdate, stableFrames: 4 });

  const sendManual = useCallback(
    (code: DirectionCode, speed = manualSpeedRef.current) => {
      const command = createDriveCommand(code, code === "S" ? 0 : speed, true);
      dispatch(command, "manual");
    },
    [dispatch],
  );

  const changeManualSpeed = useCallback(
    (speed: number) => {
      setManualSpeed(speed);
      manualSpeedRef.current = speed;
      const active = currentRef.current;
      if (modeRef.current === "MANUAL" && active && active.code !== "S") {
        sendManual(active.code, speed);
      }
    },
    [sendManual],
  );

  const changeMode = useCallback(
    (nextMode: Mode) => {
      if (nextMode === modeRef.current) return;
      dispatch(STOP_COMMAND, modeRef.current === "AUTO" ? "gesture" : "manual");
      modeRef.current = nextMode;
      setMode(nextMode);
    },
    [dispatch],
  );

  useEffect(() => {
    if (mode !== "MANUAL") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const code = KEY_MAP[event.key.toLowerCase()];
      if (!code || event.repeat) return;
      event.preventDefault();
      sendManual(code);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, sendManual]);

  // Browser heartbeat lets ESP1 distinguish an active app from a frozen tab.
  useEffect(() => {
    if (linkStatus !== "connected") return;
    void sendToBridge(currentRef.current ?? STOP_COMMAND);
    const timer = window.setInterval(() => {
      void sendToBridge(currentRef.current ?? STOP_COMMAND);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [linkStatus, sendToBridge]);

  // Independent UI safety layer in addition to the stop logic in the tracker.
  useEffect(() => {
    if (mode !== "AUTO" || tracking.status !== "ready") return;
    if (tracking.bothHandsPresent && tracking.live.setupStatus === "ready") return;
    const active = currentRef.current;
    if (!active || (active.leftMotor === 0 && active.rightMotor === 0)) return;
    const timer = window.setTimeout(() => {
      if (!tracking.bothHandsPresent) dispatch(STOP_COMMAND, "gesture");
    }, HAND_LOSS_STOP_MS);
    return () => window.clearTimeout(timer);
  }, [
    mode,
    tracking.status,
    tracking.bothHandsPresent,
    tracking.live.setupStatus,
    dispatch,
  ]);

  const holding =
    mode === "AUTO" &&
    tracking.live.code !== null &&
    tracking.live.code === current?.code;

  return (
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:overflow-hidden">
      <TopBar
        link={link}
        mode={mode}
        onModeChange={changeMode}
        fps={tracking.fps}
        trackingStatus={tracking.status}
      />

      {link.status === "error" && link.error && (
        <div className="border-b border-stop/30 bg-stop/10 px-4 py-2 text-center text-[12px] text-stop">
          {link.error}
        </div>
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-5">
        <CameraPanel
          videoRef={tracking.videoRef}
          canvasRef={tracking.canvasRef}
          status={tracking.status}
          error={tracking.error}
          live={tracking.live}
          handPresent={tracking.handPresent}
          bothHandsPresent={tracking.bothHandsPresent}
          directionDeadZone={tracking.directionDeadZone}
          mode={mode}
          onStart={() => void tracking.start()}
        />

        <aside className="flex min-h-0 w-full flex-col gap-4 lg:w-[390px]">
          <CurrentCommand
            current={current}
            previous={previous}
            mode={mode}
            holding={holding}
            connected={link.status === "connected"}
            transport={link.transport}
            pulseKey={pulseKey}
          />
          {mode === "AUTO" ? (
            <GestureLegend />
          ) : (
            <ManualPad
              active={current?.code ?? null}
              speed={manualSpeed}
              onSpeedChange={changeManualSpeed}
              onCommand={sendManual}
            />
          )}
          <CommandLog entries={log} />
        </aside>
      </main>
    </div>
  );
}
