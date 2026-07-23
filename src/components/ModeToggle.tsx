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
  return (
    <div
      role="tablist"
      aria-label="Chế độ điều khiển"
      className="flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-2 p-1"
    >
      {OPTIONS.map((option) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
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
