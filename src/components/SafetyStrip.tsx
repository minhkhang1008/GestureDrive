import { useEffect, useState } from "react";
import type { SerialLink } from "../hooks/useSerialConnection";

/** Telemetry older than this is treated as unknown vehicle state. */
const TELEMETRY_FRESH_MS = 2500;

type Tone = "ok" | "warn" | "stop" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/14 text-warn",
  stop: "bg-stop/18 text-stop",
  neutral: "bg-surface-2 text-faint",
};

interface SegmentState {
  label: string;
  state: string;
  tone: Tone;
}

function Segment({ label, state, tone }: SegmentState) {
  return (
    <div
      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 ${TONE_CLASS[tone]}`}
    >
      <span className="max-w-full truncate text-[11px] font-medium leading-none opacity-75">
        {label}
      </span>
      <span className="max-w-full truncate font-mono text-[11px] font-semibold leading-none">
        {state}
      </span>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-stop/50 bg-stop px-4 py-2 text-center text-[12px] font-bold text-white">
      {children}
    </div>
  );
}

/**
 * Slim always-visible safety chain: Serial -> LoRa -> host watchdog ->
 * vehicle failsafe -> E-stop. Green only when the stage is verified healthy,
 * amber for unknown/stale, red for an active safety trip.
 */
export function SafetyStrip({
  link,
  estopLatched,
}: {
  link: SerialLink;
  estopLatched: boolean;
}) {
  const connected = link.status === "connected";

  // Staleness advances with wall-clock time, not with events: tick while
  // connected so a silent radio degrades the strip to "?" on its own.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setTick((tick) => (tick + 1) & 0xffff), 500);
    return () => window.clearInterval(timer);
  }, [connected]);

  const telemetry = link.bridge.telemetry;
  const receivedAt = link.bridge.telemetryReceivedAt;
  const telemetryFresh =
    connected &&
    telemetry !== null &&
    receivedAt !== null &&
    performance.now() - receivedAt <= TELEMETRY_FRESH_MS;

  const serial: SegmentState = {
    label: "Serial",
    ...(link.status === "connected"
      ? { state: "OK", tone: "ok" as Tone }
      : link.status === "connecting"
        ? { state: "ĐANG NỐI", tone: "warn" as Tone }
        : link.status === "error"
          ? { state: "LỖI", tone: "stop" as Tone }
          : { state: "CHƯA NỐI", tone: "neutral" as Tone }),
  };

  const lora: SegmentState = {
    label: "LoRa",
    ...(!connected
      ? { state: "—", tone: "neutral" as Tone }
      : link.transport === "none"
        ? { state: "MẤT", tone: "stop" as Tone }
        : link.transport === "unknown"
          ? { state: "CHỜ ESP1", tone: "warn" as Tone }
          : link.bridge.radioError !== null
            ? { state: `ERR ${link.bridge.radioError}`, tone: "warn" as Tone }
            : { state: "OK", tone: "ok" as Tone }),
  };

  const hostWd: SegmentState = {
    label: "Host WD",
    ...(!connected
      ? { state: "—", tone: "neutral" as Tone }
      : link.bridge.hostTimeout
        ? { state: "TIMEOUT", tone: "stop" as Tone }
        : { state: "OK", tone: "ok" as Tone }),
  };

  const failsafe: SegmentState = {
    label: "Failsafe xe",
    ...(!connected
      ? { state: "—", tone: "neutral" as Tone }
      : !telemetryFresh
        ? { state: "?", tone: "warn" as Tone }
        : telemetry.failsafe
          ? { state: "ACTIVE", tone: "stop" as Tone }
          : { state: "CLEAR", tone: "ok" as Tone }),
  };

  const estopFromVehicle = telemetryFresh ? telemetry.estop : null;
  const estop: SegmentState = {
    label: "E-stop",
    ...(estopLatched || estopFromVehicle === true
      ? { state: "KHÓA", tone: "stop" as Tone }
      : !connected
        ? { state: "—", tone: "neutral" as Tone }
        : estopFromVehicle === false
          ? { state: "CLEAR", tone: "ok" as Tone }
          : { state: "?", tone: "warn" as Tone }),
  };

  return (
    <>
      <div
        role="status"
        aria-label="Chuỗi trạng thái an toàn"
        className="grid grid-cols-5 gap-px border-b border-line bg-line/60"
      >
        <Segment {...serial} />
        <Segment {...lora} />
        <Segment {...hostWd} />
        <Segment {...failsafe} />
        <Segment {...estop} />
      </div>

      {connected && link.bridge.hostTimeout && (
        <Banner>
          HOST TIMEOUT — ESP1 không còn nhận lệnh từ trình duyệt, xe sẽ tự dừng theo failsafe.
        </Banner>
      )}
      {connected && telemetryFresh && telemetry.failsafe && (
        <Banner>FAILSAFE ACTIVE — xe mất lệnh vô tuyến và đã tự dừng.</Banner>
      )}
      {connected && telemetryFresh && telemetry.batteryCritical === true && (
        <Banner>
          PIN CẠN — xe đã khóa motor để bảo vệ cell. Tắt nguồn và sạc lại để gỡ khóa.
        </Banner>
      )}
    </>
  );
}
