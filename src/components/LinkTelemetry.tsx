import { Radio, Usb, Warning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { SerialLink } from "../hooks/useSerialConnection";

/** Telemetry older than this is treated as unknown vehicle state. */
const TELEMETRY_FRESH_MS = 2500;
/** SX1262 sensitivity at SF7/BW250 — the floor for the 1 km link budget. */
const LORA_SENSITIVITY_DBM = -120;

type Tone = "ok" | "warn" | "stop";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  stop: "text-stop",
};

function rssiTone(rssi: number): Tone {
  if (rssi > -105) return "ok";
  if (rssi >= -115) return "warn";
  return "stop";
}

function snrTone(snr: number): Tone {
  if (snr > 0) return "ok";
  if (snr >= -5) return "warn";
  return "stop";
}

function Value({
  label,
  value,
  tone,
  dim = false,
}: {
  label: string;
  value: string;
  tone?: Tone;
  dim?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-surface-2 px-3 py-2 ${dim ? "opacity-55" : ""}`}>
      <p className="text-[9px] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p
        className={`mt-0.5 truncate font-mono text-[11px] ${tone ? TONE_TEXT[tone] : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

export function LinkTelemetry({ link }: { link: SerialLink }) {
  const connected = link.status === "connected";

  // Staleness is a function of wall-clock time: tick while connected so the
  // panel degrades to STALE even when no serial line ever arrives again.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setTick((tick) => (tick + 1) & 0xffff), 500);
    return () => window.clearInterval(timer);
  }, [connected]);

  const telemetry = link.bridge.telemetry;
  const receivedAt = link.bridge.telemetryReceivedAt;
  const stale =
    connected &&
    (receivedAt === null || performance.now() - receivedAt > TELEMETRY_FRESH_MS);

  const serialLabel =
    link.status === "connected"
      ? "CONNECTED"
      : link.status === "connecting"
        ? "CONNECTING"
        : link.status.toUpperCase();
  const radioLabel = link.transport === "lora" ? "LORA" : link.transport.toUpperCase();
  // The link is only as good as its worse direction, so the margin is quoted
  // against whichever end hears the other least well.
  const weakestRssi = telemetry
    ? Math.min(telemetry.rssi, telemetry.uplinkRssi ?? telemetry.rssi)
    : null;
  const rssiMargin = weakestRssi === null ? null : weakestRssi - LORA_SENSITIVITY_DBM;
  const batteryTone: Tone | undefined = telemetry?.batteryCritical
    ? "stop"
    : telemetry?.batteryLow
      ? "warn"
      : undefined;

  return (
    <section
      className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${
        stale ? "border-warn/50" : "border-line"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-medium text-dim">Link & telemetry</h2>
          {stale && (
            <span className="rounded-md border border-warn/50 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-warn">
              STALE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-faint">
          <Usb size={14} />
          <Radio size={14} />
          {(link.bridge.hostTimeout || telemetry?.failsafe) && (
            <Warning size={14} className="text-stop" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-3">
        <Value
          label="Serial"
          value={serialLabel}
          tone={link.status === "error" ? "stop" : undefined}
        />
        <Value
          label="LoRa"
          value={radioLabel}
          tone={link.transport === "none" ? "stop" : undefined}
        />
        <Value
          label="Host WD"
          value={link.bridge.hostTimeout ? "TIMEOUT" : "OK"}
          tone={link.bridge.hostTimeout ? "stop" : undefined}
        />
        <Value
          label="Failsafe xe"
          value={telemetry ? (telemetry.failsafe ? "ACTIVE" : "CLEAR") : "—"}
          tone={telemetry?.failsafe === true ? "stop" : undefined}
          dim={stale}
        />
        <Value
          label="E-stop xe"
          value={
            telemetry === null || telemetry.estop === null
              ? "—"
              : telemetry.estop
                ? "KHÓA"
                : "CLEAR"
          }
          tone={telemetry?.estop === true ? "stop" : undefined}
          dim={stale}
        />
        <Value
          label="Mất gói"
          value={telemetry ? `${telemetry.packetLoss.toFixed(0)}%` : "—"}
          dim={stale}
        />
        {/* Downlink: how well the vehicle hears the control station. */}
        <Value
          label="RSSI xe"
          value={telemetry ? `${telemetry.rssi.toFixed(1)} dBm` : "—"}
          tone={telemetry ? rssiTone(telemetry.rssi) : undefined}
          dim={stale}
        />
        <Value
          label="SNR xe"
          value={telemetry ? `${telemetry.snr.toFixed(1)} dB` : "—"}
          tone={telemetry ? snrTone(telemetry.snr) : undefined}
          dim={stale}
        />
        {/* Uplink: how well the station hears the vehicle's reply. */}
        <Value
          label="RSSI trạm"
          value={
            telemetry?.uplinkRssi != null
              ? `${telemetry.uplinkRssi.toFixed(1)} dBm`
              : "—"
          }
          tone={
            telemetry?.uplinkRssi != null ? rssiTone(telemetry.uplinkRssi) : undefined
          }
          dim={stale}
        />
        <Value
          label="SNR trạm"
          value={
            telemetry?.uplinkSnr != null ? `${telemetry.uplinkSnr.toFixed(1)} dB` : "—"
          }
          tone={telemetry?.uplinkSnr != null ? snrTone(telemetry.uplinkSnr) : undefined}
          dim={stale}
        />
        <Value
          label="Pin xe"
          value={
            telemetry?.batteryMv != null
              ? `${(telemetry.batteryMv / 1000).toFixed(2)} V`
              : "—"
          }
          tone={batteryTone}
          dim={stale}
        />
        <Value
          label="Output L/R"
          value={
            telemetry !== null &&
            telemetry.leftOutput !== null &&
            telemetry.rightOutput !== null
              ? `${telemetry.leftOutput} / ${telemetry.rightOutput}`
              : "—"
          }
          dim={stale}
        />
        <Value label="Radio TX seq" value={link.bridge.lastRadioSequence?.toString() ?? "—"} />
        <Value label="Host seq" value={link.lastSentSequence?.toString() ?? "—"} />
      </div>
      {telemetry && rssiMargin !== null && weakestRssi !== null && (
        <p className={`mt-2 text-[10px] ${stale ? "text-faint opacity-55" : "text-dim"}`}>
          Biên dự trữ liên kết (chiều yếu hơn):{" "}
          <span className={`font-mono ${TONE_TEXT[rssiTone(weakestRssi)]}`}>
            {rssiMargin >= 0 ? "+" : ""}
            {rssiMargin.toFixed(0)} dB
          </span>{" "}
          so với độ nhạy −120 dBm (SF7/BW250) cho mục tiêu 1 km.
        </p>
      )}
      {telemetry?.batteryCritical === true && (
        <p className="mt-2 rounded-[var(--radius-control)] border border-stop/40 bg-stop/10 px-2 py-1.5 text-[10px] font-semibold text-stop">
          PIN CẠN — xe đã tự khóa motor. Chỉ tắt nguồn và sạc lại mới gỡ được khóa này.
        </p>
      )}
      {telemetry?.batteryCritical !== true && telemetry?.batteryLow === true && (
        <p className="mt-2 rounded-[var(--radius-control)] border border-warn/40 bg-warn/10 px-2 py-1.5 text-[10px] font-semibold text-warn">
          Pin yếu — hãy đưa xe về trước khi ngưỡng cắt được kích hoạt.
        </p>
      )}
      {link.bridge.radioError !== null && (
        <p className="mt-2 font-mono text-[10px] text-stop">
          RADIO_ERROR:{link.bridge.radioError}
        </p>
      )}
      {link.bridge.hostError !== null && (
        <p className="mt-2 font-mono text-[10px] text-stop">
          HOST_ERROR:{link.bridge.hostError}
        </p>
      )}
    </section>
  );
}
