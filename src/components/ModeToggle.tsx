import { useRef } from "react";
import type { ControlMode } from "../lib/controlTypes";

const OPTIONS: { value: ControlMode; label: string }[] = [
  { value: "AUTO", label: "AUTO" },
  { value: "MANUAL", label: "MANUAL" },
  { value: "CALIBRATION", label: "CAL" },
];

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: ControlMode;
  onChange: (mode: ControlMode) => void;
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = OPTIONS.findIndex((option) => option.value === mode);
    const nextIndex = (index + delta + OPTIONS.length) % OPTIONS.length;
    const next = OPTIONS[nextIndex];
    if (!next) return;
    onChange(next.value);
    buttonsRef.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Chế độ điều khiển"
      onKeyDown={onKeyDown}
      className="flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-2 p-1"
    >
      {OPTIONS.map((option, index) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold tracking-wide transition-[background-color,color,transform] active:scale-[0.97] sm:px-3 sm:text-[12px] ${
              active
                ? "bg-accent-strong text-white"
                : "text-dim hover:bg-line hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
