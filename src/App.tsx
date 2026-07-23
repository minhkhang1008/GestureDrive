import { useCallback, useEffect, useRef, useState } from "react";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { CameraPanel } from "./components/CameraPanel";
import { CommandLog, type CommandSource, type LogEntry } from "./components/CommandLog";
import { CurrentCommand } from "./components/CurrentCommand";
import { EmergencyStop } from "./components/EmergencyStop";
import { GestureLegend } from "./components/GestureLegend";
import { LinkTelemetry } from "./components/LinkTelemetry";
import { ManualPad } from "./components/ManualPad";
import { TopBar } from "./components/TopBar";
import { useControlHeartbeat } from "./hooks/useControlHeartbeat";
import { useHandTracking } from "./hooks/useHandTracking";
import { useSerialConnection } from "./hooks/useSerialConnection";
import { createDirectionalDrive, type DirectionCode } from "./lib/commands";
import {
  COMMAND_TYPE,
  DEFAULT_SPEED_LIMIT,
  ESTOP_COMMAND,
  RESET_ESTOP_COMMAND,
  STOP_COMMAND,
  createDirectPwmCommand,
  sameControlCommand,
  type ControlCommand,
  type ControlMode,
} from "./lib/controlTypes";

interface PresentedCommand {
  command: ControlCommand;
  label: string;
  source: CommandSource;
}

const INITIAL_COMMAND: PresentedCommand = {
  command: STOP_COMMAND,
  label: "Dừng an toàn",
  source: "safety",
};

const KEY_MAP: Record<string, DirectionCode> = {
  w: "F",
  s: "B",
  a: "L",
  d: "R",
};

const HAND_LOSS_STOP_MS = 180;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable)
  );
}

export default function App() {
  const link = useSerialConnection();
  const sendToBridge = link.send;
  const serialStatus = link.status;
  const radioTransport = link.transport;
  const telemetrySnapshot = link.bridge.telemetry;
  const [mode, setMode] = useState<ControlMode>("AUTO");
  const [current, setCurrent] = useState<PresentedCommand>(INITIAL_COMMAND);
  const [previous, setPrevious] = useState<PresentedCommand | null>(null);
  const [manualSpeedLimit, setManualSpeedLimit] = useState(DEFAULT_SPEED_LIMIT);
  const [calibrationLimitPercent, setCalibrationLimitPercent] = useState(60);
  const [activeDirection, setActiveDirection] = useState<DirectionCode | null>(null);
  const [estopLatched, setEstopLatched] = useState(false);
  const [resettingEstop, setResettingEstop] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const modeRef = useRef<ControlMode>(mode);
  const currentRef = useRef<PresentedCommand>(INITIAL_COMMAND);
  const estopRef = useRef(false);
  const resettingRef = useRef(false);
  const resetAttemptRef = useRef(0);
  const pulseTimerRef = useRef<number | null>(null);
  const pressedKeysRef = useRef(new Set<string>());
  const logIdRef = useRef(0);
  const previousLinkStatusRef = useRef(link.status);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const setHeartbeatCommand = useControlHeartbeat({
    command: current.command,
    linkStatus: serialStatus,
    send: sendToBridge,
  });

  const cancelPulse = useCallback(() => {
    if (pulseTimerRef.current !== null) {
      window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
  }, []);

  const presentCommand = useCallback((next: PresentedCommand) => {
    setHeartbeatCommand(next.command);
    const existing = currentRef.current;
    if (
      sameControlCommand(existing.command, next.command) &&
      existing.label === next.label &&
      existing.source === next.source
    ) {
      return;
    }
    setPrevious(existing);
    currentRef.current = next;
    setCurrent(next);
  }, [setHeartbeatCommand]);

  const appendLog = useCallback(
    (
      command: ControlCommand,
      label: string,
      source: CommandSource,
      sequence: number | null,
      modeAtDispatch: ControlMode,
      timestamp: string,
      linkStatus: string,
      telemetry: LogEntry["telemetry"],
    ) => {
      logIdRef.current += 1;
      const entry: LogEntry = {
        id: logIdRef.current,
        timestamp,
        mode: modeAtDispatch,
        command,
        label,
        source,
        sequence,
        linkStatus,
        telemetry,
      };
      setLog((entries) => [entry, ...entries].slice(0, 250));
    },
    [],
  );

  const dispatch = useCallback(
    (command: ControlCommand, source: CommandSource, label: string) => {
      const movement = command.type !== COMMAND_TYPE.STOP;
      if (estopRef.current && movement) return;
      cancelPulse();
      presentCommand({ command, label, source });
      const modeAtDispatch = modeRef.current;
      const timestamp = new Date().toISOString();
      const linkStatus = `${serialStatus}/${radioTransport}`;
      void sendToBridge(command).then((sequence) => {
        appendLog(
          command,
          label,
          source,
          sequence,
          modeAtDispatch,
          timestamp,
          linkStatus,
          telemetrySnapshot,
        );
      });
    },
    [appendLog, cancelPulse, presentCommand, radioTransport, sendToBridge, serialStatus, telemetrySnapshot],
  );

  const stopNow = useCallback(
    (label = "STOP") => {
      if (resettingRef.current) {
        resetAttemptRef.current += 1;
        resettingRef.current = false;
        setResettingEstop(false);
      }
      setActiveDirection(null);
      pressedKeysRef.current.clear();
      dispatch(estopRef.current ? ESTOP_COMMAND : STOP_COMMAND, "safety", label);
    },
    [dispatch],
  );

  const triggerEstop = useCallback(() => {
    resetAttemptRef.current += 1;
    resettingRef.current = false;
    setResettingEstop(false);
    cancelPulse();
    estopRef.current = true;
    setEstopLatched(true);
    setActiveDirection(null);
    pressedKeysRef.current.clear();
    dispatch(ESTOP_COMMAND, "safety", "E-STOP đã khóa");
  }, [cancelPulse, dispatch]);

  const resetEstop = useCallback(async () => {
    if (resettingRef.current || !estopRef.current || link.status !== "connected") return;
    resettingRef.current = true;
    const resetAttempt = resetAttemptRef.current + 1;
    resetAttemptRef.current = resetAttempt;
    setResettingEstop(true);
    cancelPulse();

    const disarmed: PresentedCommand = {
      command: STOP_COMMAND,
      label: "Chuỗi STOP disarmed",
      source: "safety",
    };
    presentCommand(disarmed);
    for (let index = 0; index < 4; index += 1) {
      const sequence = await link.send(STOP_COMMAND);
      if (resetAttemptRef.current !== resetAttempt) return;
      if (sequence === null) {
        presentCommand({ command: ESTOP_COMMAND, label: "E-STOP vẫn khóa", source: "safety" });
        resettingRef.current = false;
        setResettingEstop(false);
        return;
      }
      await wait(55);
      if (resetAttemptRef.current !== resetAttempt) return;
    }

    presentCommand({
      command: RESET_ESTOP_COMMAND,
      label: "Yêu cầu Arm / Reset E-stop",
      source: "safety",
    });
    let resetSequence: number | null = null;
    for (let index = 0; index < 4; index += 1) {
      resetSequence = await link.send(RESET_ESTOP_COMMAND);
      if (resetAttemptRef.current !== resetAttempt) return;
      if (resetSequence === null) {
        presentCommand({ command: ESTOP_COMMAND, label: "E-STOP vẫn khóa", source: "safety" });
        resettingRef.current = false;
        setResettingEstop(false);
        return;
      }
      await wait(55);
      if (resetAttemptRef.current !== resetAttempt) return;
    }

    estopRef.current = false;
    setEstopLatched(false);
    resettingRef.current = false;
    setResettingEstop(false);
    presentCommand(INITIAL_COMMAND);
    await link.send(STOP_COMMAND);
    appendLog(
      RESET_ESTOP_COMMAND,
      "Arm / Reset E-stop hoàn tất",
      "safety",
      resetSequence,
      modeRef.current,
      new Date().toISOString(),
      `${link.status}/${link.transport}`,
      link.bridge.telemetry,
    );
  }, [appendLog, cancelPulse, link, presentCommand]);

  const onControlUpdate = useCallback(
    (command: ControlCommand) => {
      if (modeRef.current !== "AUTO" || estopRef.current) return;
      dispatch(command, "gesture", command.type === COMMAND_TYPE.STOP ? "Gesture STOP" : "Gesture DRIVE");
    },
    [dispatch],
  );

  const tracking = useHandTracking({ onControlUpdate, stableFrames: 4 });

  const startManual = useCallback(
    (code: DirectionCode) => {
      if (code === "S") {
        stopNow("STOP từ manual pad");
        return;
      }
      setActiveDirection(code);
      dispatch(
        createDirectionalDrive(code, manualSpeedLimit, true),
        "manual",
        `Giữ ${code}`,
      );
    },
    [dispatch, manualSpeedLimit, stopNow],
  );

  const startCalibration = useCallback(
    (left: number, right: number, label: string) => {
      const limit = calibrationLimitPercent * 10;
      dispatch(createDirectPwmCommand(left, right, limit), "calibration", label);
    },
    [calibrationLimitPercent, dispatch],
  );

  const runTimedPulse = useCallback(
    (left: number, right: number, durationMs: number, label: string) => {
      startCalibration(left, right, label);
      pulseTimerRef.current = window.setTimeout(() => {
        pulseTimerRef.current = null;
        stopNow(`Timed pulse ${durationMs} ms hoàn tất`);
      }, durationMs);
    },
    [startCalibration, stopNow],
  );

  const changeMode = useCallback(
    (nextMode: ControlMode) => {
      if (nextMode === modeRef.current) return;
      stopNow("STOP trước khi đổi mode");
      modeRef.current = nextMode;
      setMode(nextMode);
    },
    [stopNow],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === " ") {
        event.preventDefault();
        if (!event.repeat) stopNow("STOP bằng Space");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) triggerEstop();
        return;
      }
      if (modeRef.current === "AUTO" || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const code = KEY_MAP[key];
      if (!code || event.repeat || pressedKeysRef.current.has(key)) return;
      event.preventDefault();
      pressedKeysRef.current.add(key);
      if (modeRef.current === "MANUAL") {
        startManual(code);
        return;
      }
      const limit = calibrationLimitPercent * 10;
      const direct: Record<string, [number, number]> = {
        w: [limit, limit],
        s: [-limit, -limit],
        a: [-limit, limit],
        d: [limit, -limit],
      };
      const [left, right] = direct[key];
      startCalibration(left, right, `Giữ phím ${key.toUpperCase()}`);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!pressedKeysRef.current.delete(key)) return;
      event.preventDefault();
      stopNow(`Nhả phím ${key.toUpperCase()}`);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [calibrationLimitPercent, startCalibration, startManual, stopNow, triggerEstop]);

  useEffect(() => {
    const stopForLifecycle = () => stopNow("STOP do mất focus hoặc ẩn trang");
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopForLifecycle();
    };
    window.addEventListener("blur", stopForLifecycle);
    window.addEventListener("pagehide", stopForLifecycle);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", stopForLifecycle);
      window.removeEventListener("pagehide", stopForLifecycle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [stopNow]);

  useEffect(() => {
    const previousStatus = previousLinkStatusRef.current;
    previousLinkStatusRef.current = link.status;
    if (previousStatus === "connected" && link.status !== "connected") {
      cancelPulse();
      const safe = estopRef.current ? ESTOP_COMMAND : STOP_COMMAND;
      presentCommand({ command: safe, label: "STOP do mất serial", source: "safety" });
    }
  }, [cancelPulse, link.status, presentCommand]);

  useEffect(() => {
    if (mode !== "AUTO" || current.command.type === COMMAND_TYPE.STOP) return;
    const trackingSafe =
      tracking.status === "ready" &&
      tracking.bothHandsPresent &&
      tracking.live.setupStatus === "ready";
    if (trackingSafe) return;
    const timer = window.setTimeout(() => stopNow("STOP do mất tay hoặc camera"), HAND_LOSS_STOP_MS);
    return () => window.clearTimeout(timer);
  }, [current.command.type, mode, stopNow, tracking.bothHandsPresent, tracking.live.setupStatus, tracking.status]);

  useEffect(() => () => cancelPulse(), [cancelPulse]);

  const sidePanel = (
    <aside className="flex min-w-0 flex-col gap-4 lg:w-[410px] lg:shrink-0">
      <EmergencyStop
        latched={estopLatched}
        resetting={resettingEstop}
        canReset={link.status === "connected"}
        onEstop={triggerEstop}
        onReset={() => void resetEstop()}
      />
      <CurrentCommand
        current={current.command}
        previous={previous?.command ?? null}
        label={current.label}
        previousLabel={previous?.label ?? null}
        mode={mode}
        sequence={link.lastSentSequence}
        estopLatched={estopLatched}
      />
      <LinkTelemetry link={link} />
      <CommandLog entries={log} />
    </aside>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col">
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

      {estopLatched && (
        <div className="border-b border-stop/50 bg-stop px-4 py-2 text-center text-[12px] font-bold text-white">
          E-STOP ĐANG KHÓA. Không lệnh chuyển động nào được gửi.
        </div>
      )}

      <main className="mx-auto w-full max-w-[1480px] flex-1 p-4 lg:p-5">
        {mode === "CALIBRATION" ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
            <CalibrationPanel
              safetyLimitPercent={calibrationLimitPercent}
              onSafetyLimitChange={setCalibrationLimitPercent}
              onDirectStart={startCalibration}
              onStop={() => stopNow("Nhả dead-man calibration")}
              onPulse={runTimedPulse}
            />
            {sidePanel}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1">
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
              <div className="mt-4">
                {mode === "AUTO" ? (
                  <GestureLegend />
                ) : (
                  <ManualPad
                    active={activeDirection}
                    speedLimit={manualSpeedLimit}
                    onSpeedLimitChange={(value) => {
                      stopNow("STOP trước khi đổi speed limit");
                      setManualSpeedLimit(value);
                    }}
                    onStart={startManual}
                    onStop={() => stopNow("Nhả dead-man manual")}
                  />
                )}
              </div>
            </div>
            {sidePanel}
          </div>
        )}
      </main>
    </div>
  );
}
