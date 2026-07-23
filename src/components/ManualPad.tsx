import { Gauge, HandPalm } from "@phosphor-icons/react";
import { CommandGlyph } from "./CommandGlyph";
import { COMMAND_ORDER, COMMANDS, type DirectionCode } from "../lib/commands";

const KEY_HINT: Partial<Record<DirectionCode, string>> = {
  F: "W",
  B: "S",
  L: "A",
  R: "D",
  S: "Space",
};

function DeadmanDirection({
  code,
  active,
  onStart,
  onStop,
}: {
  code: DirectionCode;
  active: boolean;
  onStart: (code: DirectionCode) => void;
  onStop: () => void;
}) {
  const stop = code === "S";
  const release = () => onStop();

  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (stop) onStop();
        else onStart(code);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`${COMMANDS[code].label}${KEY_HINT[code] ? ` (${KEY_HINT[code]})` : ""}`}
      className={`flex aspect-square select-none touch-none flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] border transition-[background-color,border-color,color,transform] active:scale-[0.94] ${
        stop
          ? "border-stop/50 bg-stop/12 text-stop hover:bg-stop/20"
          : active
            ? "border-accent/60 bg-accent/20 text-accent"
            : "border-line bg-surface-2 text-dim hover:border-line-strong hover:text-ink"
      }`}
    >
      {stop ? <HandPalm size={20} weight="bold" /> : <CommandGlyph code={code} size={20} />}
      <span className="font-mono text-[9px] opacity-70">{KEY_HINT[code] ?? code}</span>
    </button>
  );
}

export function ManualPad({
  active,
  speedLimit,
  onSpeedLimitChange,
  onStart,
  onStop,
}: {
  active: DirectionCode | null;
  speedLimit: number;
  onSpeedLimitChange: (speedLimit: number) => void;
  onStart: (code: DirectionCode) => void;
  onStop: () => void;
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[12px] font-medium text-dim">Điều khiển MANUAL</h2>
          <p className="mt-0.5 text-[10px] text-faint">Nhấn giữ để chạy, thả để dừng</p>
        </div>
        <span className="font-mono text-[11px] text-accent">LIMIT {speedLimit}</span>
      </div>

      <div className="grid grid-cols-[1fr_126px] gap-4">
        <div className="grid grid-cols-3 gap-1.5">
          {COMMAND_ORDER.map((code) => (
            <DeadmanDirection
              key={code}
              code={code}
              active={active === code}
              onStart={onStart}
              onStop={onStop}
            />
          ))}
        </div>

        <label className="flex flex-col justify-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-3">
          <span className="flex items-center gap-1.5 text-[11px] text-dim">
            <Gauge size={14} /> Giới hạn
          </span>
          <input
            type="range"
            min="0"
            max="1000"
            step="25"
            value={speedLimit}
            onChange={(event) => onSpeedLimitChange(Number(event.target.value))}
            className="w-full accent-accent"
            aria-label="Giới hạn tốc độ manual"
          />
          <span className="font-mono text-[10px] leading-snug text-faint">
            {Math.round(speedLimit / 10)}% packet
          </span>
        </label>
      </div>

      <p className="mt-4 text-center text-[11px] text-faint">
        Giữ W/A/S/D để chạy. Space luôn dừng.
      </p>
    </section>
  );
}
