import { Gauge, HandPalm } from "@phosphor-icons/react";
import { CommandGlyph } from "./CommandGlyph";
import {
  COMMAND_ORDER,
  COMMANDS,
  type DirectionCode,
} from "../lib/commands";

const KEY_HINT: Partial<Record<DirectionCode, string>> = {
  F: "W",
  B: "S",
  L: "A",
  R: "D",
  S: "Space",
};

function PadKey({
  code,
  active,
  onPress,
}: {
  code: DirectionCode;
  active: boolean;
  onPress: (code: DirectionCode) => void;
}) {
  const isStop = code === "S";
  const palette = isStop
    ? active
      ? "border-stop/60 bg-stop/20 text-stop"
      : "border-line bg-surface-2 text-stop/80 hover:border-stop/40"
    : active
      ? "border-accent/60 bg-accent/20 text-accent"
      : "border-line bg-surface-2 text-dim hover:border-line-strong hover:text-ink";

  return (
    <button
      onPointerDown={() => onPress(code)}
      aria-label={`${COMMANDS[code].label}${KEY_HINT[code] ? ` (${KEY_HINT[code]})` : ""}`}
      className={`group flex aspect-square select-none flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] border transition-all active:scale-[0.94] ${palette}`}
    >
      {isStop ? (
        <HandPalm size={20} weight={active ? "fill" : "bold"} />
      ) : (
        <CommandGlyph code={code} size={20} />
      )}
      <span className="font-mono text-[9px] opacity-65">
        {KEY_HINT[code] ?? code}
      </span>
    </button>
  );
}

export function ManualPad({
  active,
  speed,
  onSpeedChange,
  onCommand,
}: {
  active: DirectionCode | null;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onCommand: (code: DirectionCode) => void;
}) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12px] font-medium text-dim">Điều khiển thủ công</p>
        <span className="font-mono text-[11px] text-accent">PWM {speed}</span>
      </div>

      <div className="grid grid-cols-[1fr_126px] gap-4">
        <div className="grid grid-cols-3 gap-1.5">
          {COMMAND_ORDER.map((code) => (
            <PadKey
              key={code}
              code={code}
              active={active === code}
              onPress={onCommand}
            />
          ))}
        </div>

        <label className="flex flex-col justify-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-3">
          <span className="flex items-center gap-1.5 text-[11px] text-dim">
            <Gauge size={14} /> Tốc độ
          </span>
          <input
            type="range"
            min="0"
            max="255"
            step="5"
            value={speed}
            onChange={(event) => onSpeedChange(Number(event.target.value))}
            className="w-full accent-accent"
            aria-label="Tốc độ động cơ thủ công"
          />
          <span className="text-[10px] leading-snug text-faint">
            Đổi tốc độ sẽ cập nhật hướng đang chạy.
          </span>
        </label>
      </div>

      <p className="mt-4 text-center text-[11px] text-faint">
        W A S D cho bốn hướng chính, Space để dừng.
      </p>
    </div>
  );
}
