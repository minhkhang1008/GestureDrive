import { motion } from "motion/react";

export type Mode = "AUTO" | "MANUAL";

const OPTIONS: { value: Mode; label: string }[] = [
  { value: "AUTO", label: "AUTO" },
  { value: "MANUAL", label: "MANUAL" },
];

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Chế độ điều khiển"
      className="relative flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-2 p-1"
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className="relative px-4 py-1.5 text-[13px] font-semibold tracking-wide transition-colors"
          >
            {active && (
              <motion.span
                layoutId="mode-pill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-lg bg-accent-strong"
              />
            )}
            <span
              className={
                active ? "relative text-white" : "relative text-dim hover:text-ink"
              }
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
