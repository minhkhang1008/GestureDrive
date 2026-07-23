import { ClockCounterClockwise, DownloadSimple } from "@phosphor-icons/react";
import { commandTypeName, type ControlCommand, type ControlMode } from "../lib/controlTypes";
import type { Telemetry } from "../lib/serialProtocol";

export type CommandSource = "gesture" | "manual" | "calibration" | "safety";

export interface LogEntry {
  id: number;
  timestamp: string;
  mode: ControlMode;
  command: ControlCommand;
  label: string;
  source: CommandSource;
  sequence: number | null;
  linkStatus: string;
  telemetry: Telemetry | null;
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCsv(entries: LogEntry[]) {
  const headers = [
    "timestamp", "mode", "source", "label", "type", "channelA", "channelB",
    "speedLimit", "flags", "sequence", "linkStatus", "rssi", "snr",
    "packetLoss", "vehicleFailsafe", "batteryMv",
  ];
  const rows = entries.map((entry) => [
    entry.timestamp,
    entry.mode,
    entry.source,
    entry.label,
    commandTypeName(entry.command.type),
    entry.command.channelA,
    entry.command.channelB,
    entry.command.speedLimit,
    entry.command.flags,
    entry.sequence,
    entry.linkStatus,
    entry.telemetry?.rssi ?? null,
    entry.telemetry?.snr ?? null,
    entry.telemetry?.packetLoss ?? null,
    entry.telemetry?.failsafe ?? null,
    entry.telemetry?.batteryMv ?? null,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gesturedrive-${new Date().toISOString().replaceAll(":", "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CommandLog({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="flex min-h-52 flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-medium text-dim">Nhật ký lệnh</h2>
          <p className="font-mono text-[10px] text-faint">{entries.length} sự kiện</p>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(entries)}
          disabled={entries.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[10px] font-medium text-dim transition-[color,border-color,transform] hover:border-line-strong hover:text-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <DownloadSimple size={13} /> CSV
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <ClockCounterClockwise size={22} className="text-faint" />
          <p className="text-[11px] text-faint">Chưa có thao tác điều khiển.</p>
        </div>
      ) : (
        <div className="max-h-64 min-h-0 overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="grid grid-cols-[54px_1fr_auto] items-center gap-2 border-b border-line/70 px-1 py-2 last:border-b-0">
              <span className="font-mono text-[9px] text-faint">
                {new Date(entry.timestamp).toLocaleTimeString("vi-VN", { hour12: false })}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-ink">{entry.label}</span>
                <span className="block truncate font-mono text-[9px] text-faint">
                  {entry.mode} / {commandTypeName(entry.command.type)} / A {entry.command.channelA} / B {entry.command.channelB}
                </span>
              </span>
              <span className="font-mono text-[9px] text-dim">#{entry.sequence ?? "-"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
