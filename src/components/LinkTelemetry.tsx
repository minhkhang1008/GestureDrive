import { Radio, Usb, Warning } from "@phosphor-icons/react";
import type { SerialLink } from "../hooks/useSerialConnection";

function Value({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-[9px] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-[11px] ${alert ? "text-stop" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

export function LinkTelemetry({ link }: { link: SerialLink }) {
  const telemetry = link.bridge.telemetry;
  const serialLabel =
    link.status === "connected"
      ? "CONNECTED"
      : link.status === "connecting"
        ? "CONNECTING"
        : link.status.toUpperCase();
  const radioLabel = link.transport === "lora" ? "LORA" : link.transport.toUpperCase();

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[12px] font-medium text-dim">Link & telemetry</h2>
        <div className="flex items-center gap-2 text-faint">
          <Usb size={14} />
          <Radio size={14} />
          {(link.bridge.hostTimeout || telemetry?.failsafe) && <Warning size={14} className="text-stop" />}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        <Value label="Serial" value={serialLabel} alert={link.status === "error"} />
        <Value label="LoRa" value={radioLabel} alert={link.transport === "none"} />
        <Value
          label="Host timeout"
          value={link.bridge.hostTimeout ? "ACTIVE" : "CLEAR"}
          alert={link.bridge.hostTimeout}
        />
        <Value
          label="Vehicle failsafe"
          value={telemetry ? (telemetry.failsafe ? "ACTIVE" : "CLEAR") : "N/A"}
          alert={telemetry?.failsafe === true}
        />
        <Value label="Radio TX seq" value={link.bridge.lastRadioSequence?.toString() ?? "N/A"} />
        <Value label="Host seq" value={link.lastSentSequence?.toString() ?? "N/A"} />
        <Value label="RSSI" value={telemetry ? `${telemetry.rssi.toFixed(1)} dBm` : "N/A"} />
        <Value label="SNR" value={telemetry ? `${telemetry.snr.toFixed(1)} dB` : "N/A"} />
      </div>
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
