import { ArrowCounterClockwise, WarningOctagon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { CameraPanel } from "./components/CameraPanel";
import { CommandLog, type CommandSource, type LogEntry } from "./components/CommandLog";
import { CurrentCommand } from "./components/CurrentCommand";
import { EmergencyStop } from "./components/EmergencyStop";
import { GestureLegend } from "./components/GestureLegend";
import { LinkTelemetry } from "./components/LinkTelemetry";
import { ManualPad } from "./components/ManualPad";
import { SafetyStrip } from "./components/SafetyStrip";
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
/** Telemetry older than this is treated as unknown vehicle state. */
const TELEMETRY_FRESH_MS = 2500;

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
  const telemetryReceivedAt = link.bridge.telemetryReceivedAt;
  const [mode, setMode] = useState<ControlMode>("AUTO");
  const [current, setCurrent] = useState<PresentedCommand>(INITIAL_COMMAND);
  const [previous, setPrevious] = useState<PresentedCommand | null>(null);
  const [manualSpeedLimit, setManualSpeedLimit] = useState(DEFAULT_SPEED_LIMIT);
  const [calibrationLimitPercent, setCalibrationLimitPercent] = useState(60);
  const [activeDirection, setActiveDirection] = useState<DirectionCode | null>(null);
  const [estopLatched, setEstopLatched] = useState(false);
  const [resettingEstop, setResettingEstop] = useState(false);
  const [estopResetNote, setEstopResetNote] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const modeRef = useRef<ControlMode>(mode);
  const currentRef = useRef<PresentedCommand>(INITIAL_COMMAND);
  const estopRef = useRef(false);
  const resettingRef = useRef(false);
  const resetAttemptRef = useRef(0);
  const pulseTimerRef = useRef<number | null>(null);
  const keyStackRef = useRef<string[]>([]);
  const logIdRef = useRef(0);
  const lastGestureLogRef = useRef<string | null>(null);
  const previousLinkStatusRef = useRef(link.status);
  // Log context lives in refs so dispatch and the window key listeners do not
  // re-subscribe every time telemetry arrives.
  const serialStatusRef = useRef(serialStatus);
  const radioTransportRef = useRef(radioTransport);
  const telemetryRef = useRef(telemetrySnapshot);
  const telemetryReceivedAtRef = useRef(telemetryReceivedAt);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    serialStatusRef.current = serialStatus;
    radioTransportRef.current = radioTransport;
    telemetryRef.current = telemetrySnapshot;
    telemetryReceivedAtRef.current = telemetryReceivedAt;
  }, [radioTransport, serialStatus, telemetrySnapshot, telemetryReceivedAt]);

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
        linkStatus: `${serialStatusRef.current}/${radioTransportRef.current}`,
        telemetry: telemetryRef.current,
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
      void sendToBridge(command).then((sequence) => {
        appendLog(command, label, source, sequence, modeAtDispatch, timestamp);
      });
    },
    [appendLog, cancelPulse, presentCommand, sendToBridge],
  );

  const stopNow = useCallback(
    (label = "STOP") => {
      if (resettingRef.current) {
        resetAttemptRef.current += 1;
        resettingRef.current = false;
        setResettingEstop(false);
      }
      setActiveDirection(null);
      keyStackRef.current = [];
      dispatch(estopRef.current ? ESTOP_COMMAND : STOP_COMMAND, "safety", label);
    },
    [dispatch],
  );

  const triggerEstop = useCallback(() => {
    resetAttemptRef.current += 1;
    resettingRef.current = false;
    setResettingEstop(false);
    setEstopResetNote(null);
    cancelPulse();
    estopRef.current = true;
    setEstopLatched(true);
    setActiveDirection(null);
    keyStackRef.current = [];
    dispatch(ESTOP_COMMAND, "safety", "E-STOP đã khóa");
  }, [cancelPulse, dispatch]);

  const resetEstop = useCallback(async () => {
    if (resettingRef.current || !estopRef.current || link.status !== "connected") return;
    resettingRef.current = true;
    const resetAttempt = resetAttemptRef.current + 1;
    resetAttemptRef.current = resetAttempt;
    setResettingEstop(true);
    setEstopResetNote(null);
    cancelPulse();

    const abortReset = (label: string) => {
      presentCommand({ command: ESTOP_COMMAND, label, source: "safety" });
      resettingRef.current = false;
      setResettingEstop(false);
    };

    // Phase 1: a clean run of disarmed STOPs. ESP2 requires at least three
    // before it will honor RESET_ESTOP; ten give margin over radio loss.
    presentCommand({
      command: STOP_COMMAND,
      label: "Chuỗi STOP disarmed",
      source: "safety",
    });
    for (let index = 0; index < 10; index += 1) {
      const sequence = await link.send(STOP_COMMAND);
      if (resetAttemptRef.current !== resetAttempt) return;
      if (sequence === null) {
        abortReset("E-STOP vẫn khóa");
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
        abortReset("E-STOP vẫn khóa");
        return;
      }
      await wait(55);
      if (resetAttemptRef.current !== resetAttempt) return;
    }

    // Phase 3: close the loop with vehicle telemetry when it is flowing.
    const telemetryFresh = () =>
      telemetryReceivedAtRef.current !== null &&
      performance.now() - telemetryReceivedAtRef.current <= TELEMETRY_FRESH_MS;

    let confirmed = false;
    let sawTelemetry = false;
    for (let index = 0; index < 6; index += 1) {
      if (telemetryFresh()) {
        sawTelemetry = true;
        if (telemetryRef.current?.estop === false) {
          confirmed = true;
          break;
        }
      }
      await link.send(STOP_COMMAND);
      await wait(250);
      if (resetAttemptRef.current !== resetAttempt) return;
    }

    if (sawTelemetry && !confirmed) {
      abortReset("Xe chưa xác nhận reset E-stop");
      setEstopResetNote(
        "Telemetry vẫn báo E-stop khóa trên xe. Kiểm tra liên kết LoRa rồi thử lại.",
      );
      return;
    }

    estopRef.current = false;
    setEstopLatched(false);
    resettingRef.current = false;
    setResettingEstop(false);
    setEstopResetNote(
      confirmed
        ? null
        : "Đã reset phía trạm điều khiển. Chưa có telemetry từ xe để xác nhận.",
    );
    presentCommand(INITIAL_COMMAND);
    await link.send(STOP_COMMAND);
    appendLog(
      RESET_ESTOP_COMMAND,
      confirmed ? "Arm / Reset E-stop: xe đã xác nhận" : "Arm / Reset E-stop (chưa xác nhận)",
      "safety",
      resetSequence,
      modeRef.current,
      new Date().toISOString(),
    );
  }, [appendLog, cancelPulse, link, presentCommand]);

  // Vehicle-reported E-stop wins: if fresh telemetry says the latch is set
  // while the UI thinks it is clear, re-latch so the reset flow stays the
  // single path back to armed.
  useEffect(() => {
    if (!telemetrySnapshot || telemetryReceivedAt === null) return;
    if (
      telemetrySnapshot.estop === true &&
      !estopRef.current &&
      !resettingRef.current
    ) {
      estopRef.current = true;
      setEstopLatched(true);
      presentCommand({
        command: ESTOP_COMMAND,
        label: "E-STOP báo từ xe",
        source: "safety",
      });
    }
  }, [presentCommand, telemetryReceivedAt, telemetrySnapshot]);

  const onControlUpdate = useCallback(
    (command: ControlCommand, label: string) => {
      if (modeRef.current !== "AUTO" || estopRef.current) return;
      cancelPulse();
      presentCommand({ command, label, source: "gesture" });
      // Analog updates stream continuously; the log only records transitions
      // (sector change, stop/start) so it stays readable.
      const shouldLog = label !== lastGestureLogRef.current;
      lastGestureLogRef.current = label;
      const modeAtDispatch = modeRef.current;
      const timestamp = new Date().toISOString();
      void sendToBridge(command).then((sequence) => {
        if (!shouldLog) return;
        appendLog(command, label, "gesture", sequence, modeAtDispatch, timestamp);
      });
    },
    [appendLog, cancelPulse, presentCommand, sendToBridge],
  );

  const tracking = useHandTracking({ onControlUpdate });
  const resetTrackingControl = tracking.resetControlState;

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
      // A stale gesture command must never survive a mode round trip: clear
      // the tracker's emit-dedupe state and force role re-confirmation.
      resetTrackingControl();
      lastGestureLogRef.current = null;
      modeRef.current = nextMode;
      setMode(nextMode);
    },
    [resetTrackingControl, stopNow],
  );

  const applyDirectionKey = useCallback(
    (key: string) => {
      const code = KEY_MAP[key];
      if (!code) return;
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
      const channels = direct[key];
      if (!channels) return;
      startCalibration(channels[0], channels[1], `Giữ phím ${key.toUpperCase()}`);
    },
    [calibrationLimitPercent, startCalibration, startManual],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === " ") {
        if (!isEditableTarget(event.target)) event.preventDefault();
        if (!event.repeat) stopNow("STOP bằng Space");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) triggerEstop();
        return;
      }
      if (modeRef.current === "AUTO" || isEditableTarget(event.target)) return;
      // Browser/system shortcuts must never start the vehicle.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!KEY_MAP[key] || event.repeat) return;
      event.preventDefault();
      const stack = keyStackRef.current;
      if (!stack.includes(key)) stack.push(key);
      applyDirectionKey(key);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const stack = keyStackRef.current;
      const index = stack.indexOf(key);
      if (index === -1) return;
      event.preventDefault();
      stack.splice(index, 1);
      const nextKey = stack[stack.length - 1];
      if (nextKey) {
        // Most-recent still-held key takes over instead of stopping the run.
        applyDirectionKey(nextKey);
        return;
      }
      stopNow(`Nhả phím ${key.toUpperCase()}`);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [applyDirectionKey, stopNow, triggerEstop]);

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

  // Screen sleep silently stops the vehicle mid-run: hold a wake lock while
  // the serial link is up, re-acquiring on return to visibility (the browser
  // releases wake locks whenever the page hides).
  useEffect(() => {
    if (serialStatus !== "connected") return;
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
      } catch {
        // Wake lock denial is non-fatal; the watchdogs still protect the run.
      }
    };
    void acquire();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, [serialStatus]);

  useEffect(() => {
    const previousStatus = previousLinkStatusRef.current;
    previousLinkStatusRef.current = link.status;
    if (previousStatus === "connected" && link.status !== "connected") {
      cancelPulse();
      setActiveDirection(null);
      keyStackRef.current = [];
      const safe = estopRef.current ? ESTOP_COMMAND : STOP_COMMAND;
      presentCommand({ command: safe, label: "STOP do mất serial", source: "safety" });
    }
  }, [cancelPulse, link.status, presentCommand]);

  useEffect(() => {
    if (mode !== "AUTO" || current.command.type === COMMAND_TYPE.STOP) return;
    const trackingSafe =
      tracking.status === "ready" &&
      tracking.driveReady &&
      tracking.live.setupStatus === "ready" &&
      !tracking.live.stalled;
    if (trackingSafe) return;
    const timer = window.setTimeout(() => stopNow("STOP do mất tay hoặc camera"), HAND_LOSS_STOP_MS);
    return () => window.clearTimeout(timer);
  }, [current.command.type, mode, stopNow, tracking.driveReady, tracking.live.setupStatus, tracking.live.stalled, tracking.status]);

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
      {estopResetNote && (
        <p className="rounded-[var(--radius-control)] border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          {estopResetNote}
        </p>
      )}
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

      <SafetyStrip link={link} estopLatched={estopLatched} />

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
                driveReady={tracking.driveReady}
                inferenceMs={tracking.inferenceMs}
                pipelineLatencyMs={tracking.pipelineLatencyMs}
                delegate={tracking.delegate}
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

      {/* Sticky E-stop for touch layouts: the side-panel button scrolls away
          on <lg, but the emergency control must never leave the screen. */}
      <div
        className="sticky bottom-0 z-50 border-t border-stop/30 bg-bg/90 px-3 pt-2 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        {estopLatched ? (
          <button
            type="button"
            onClick={() => void resetEstop()}
            disabled={link.status !== "connected" || resettingEstop}
            title={
              link.status === "connected"
                ? undefined
                : "Kết nối ESP1 trước khi reset E-stop"
            }
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-stop/50 bg-stop/15 px-4 py-2.5 text-[13px] font-bold text-stop transition-[background-color,transform] hover:bg-stop/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowCounterClockwise size={17} />
            {resettingEstop ? "Đang reset" : "Arm / Reset"}
          </button>
        ) : (
          <button
            type="button"
            onClick={triggerEstop}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-stop px-4 py-2.5 text-[14px] font-bold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
          >
            <WarningOctagon size={20} weight="fill" />
            E-STOP
          </button>
        )}
      </div>
    </div>
  );
}
