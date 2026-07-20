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
import type { CommandCode } from "./lib/commands";

const KEY_MAP: Record<string, CommandCode> = {
  w: "F",
  s: "B",
  a: "L",
  d: "R",
  " ": "S",
};

function clock(): string {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

export default function App() {
  const link = useSerialConnection();
  const [mode, setMode] = useState<Mode>("AUTO");
  const [current, setCurrent] = useState<CommandCode | null>(null);
  const [previous, setPrevious] = useState<CommandCode | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pulseKey, setPulseKey] = useState(0);

  const currentRef = useRef<CommandCode | null>(null);
  const modeRef = useRef<Mode>(mode);
  const logId = useRef(0);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Single choke point: send over the wire, update state, record the log.
  const dispatch = useCallback(
    (code: CommandCode, source: "gesture" | "manual") => {
      void link.send(code);
      setPrevious(currentRef.current);
      currentRef.current = code;
      setCurrent(code);
      setPulseKey((k) => k + 1);
      logId.current += 1;
      const entry: LogEntry = { id: logId.current, code, time: clock(), source };
      setLog((l) => [entry, ...l].slice(0, 40));
    },
    [link],
  );

  // AUTO: the recognizer only emits on a stable change, so this is already
  // deduplicated. Guard against re-sending the active command anyway.
  const onStableCommand = useCallback(
    (code: CommandCode) => {
      if (modeRef.current !== "AUTO") return;
      if (code === currentRef.current) return;
      dispatch(code, "gesture");
    },
    [dispatch],
  );

  const tracking = useHandTracking({ onStableCommand, stableFrames: 4 });

  // MANUAL: keyboard shortcuts (W A S D, Space to stop).
  useEffect(() => {
    if (mode !== "MANUAL") return;
    const onKey = (e: KeyboardEvent) => {
      const code = KEY_MAP[e.key.toLowerCase()];
      if (!code) return;
      e.preventDefault();
      if (e.repeat) return;
      dispatch(code, "manual");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, dispatch]);

  // Safety stop: in AUTO, if the hand leaves the frame for ~1s, halt the car.
  useEffect(() => {
    if (mode !== "AUTO" || tracking.status !== "ready") return;
    if (tracking.handPresent) return;
    if (currentRef.current === null || currentRef.current === "S") return;
    const t = setTimeout(() => {
      if (!tracking.handPresent && currentRef.current !== "S") {
        dispatch("S", "gesture");
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [mode, tracking.status, tracking.handPresent, dispatch]);

  const linked = link.status === "connected" || link.status === "demo";
  const holding =
    mode === "AUTO" &&
    tracking.live.code !== null &&
    tracking.live.code === current;

  return (
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:overflow-hidden">
      <TopBar
        link={link}
        mode={mode}
        onModeChange={setMode}
        fps={tracking.fps}
        trackingStatus={tracking.status}
      />

      {/* First-run hint: reach demo mode without hardware */}
      {link.status === "disconnected" && (
        <div className="flex items-center justify-center gap-2 border-b border-line bg-surface/60 px-4 py-2 text-center text-[12px] text-dim">
          <span>Chưa có ESP32?</span>
          <button
            onClick={link.startDemo}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Chạy thử ở chế độ giả lập
          </button>
        </div>
      )}
      {link.status === "error" && link.error && (
        <div className="border-b border-stop/30 bg-stop/10 px-4 py-2 text-center text-[12px] text-stop">
          {link.error}
        </div>
      )}

      <main className="mx-auto flex w-full min-h-0 max-w-[1440px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-5">
        <CameraPanel
          videoRef={tracking.videoRef}
          canvasRef={tracking.canvasRef}
          status={tracking.status}
          error={tracking.error}
          live={tracking.live}
          handPresent={tracking.handPresent}
          mode={mode}
          onStart={() => void tracking.start()}
        />

        <aside className="flex w-full min-h-0 flex-col gap-4 lg:w-[380px]">
          <CurrentCommand
            current={current}
            previous={previous}
            mode={mode}
            holding={holding}
            linked={linked}
            pulseKey={pulseKey}
          />
          {mode === "AUTO" ? (
            <GestureLegend />
          ) : (
            <ManualPad active={current} onCommand={(c) => dispatch(c, "manual")} />
          )}
          <CommandLog entries={log} />
        </aside>
      </main>
    </div>
  );
}
