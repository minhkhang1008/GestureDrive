import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { HandTap, Cursor, ClockCounterClockwise } from "@phosphor-icons/react";
import { COMMANDS, type CommandCode } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";

export interface LogEntry {
  id: number;
  code: CommandCode;
  time: string;
  source: "gesture" | "manual";
}

export function CommandLog({ entries }: { entries: LogEntry[] }) {
  const reduce = useReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-medium text-dim">Nhật ký lệnh</p>
        <span className="font-mono text-[11px] text-faint">
          {entries.length} đã gửi
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <ClockCounterClockwise size={22} className="text-faint" />
          <p className="text-[12px] text-faint">
            Chưa có lệnh nào được gửi tới xe.
          </p>
        </div>
      ) : (
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-2">
          <AnimatePresence initial={false}>
            {entries.map((e) => {
              const cmd = COMMANDS[e.code];
              const isStop = e.code === "S";
              return (
                <motion.div
                  key={e.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                >
                  <span className="font-mono text-[11px] tabular-nums text-faint">
                    {e.time}
                  </span>
                  <span
                    className={`grid size-6 place-items-center rounded-md ${
                      isStop ? "bg-stop/15 text-stop" : "bg-accent/15 text-accent"
                    }`}
                  >
                    <CommandGlyph code={e.code} size={13} />
                  </span>
                  <span className="flex-1 text-[13px] font-medium text-ink">
                    {cmd.label}
                  </span>
                  <span
                    className="text-faint"
                    title={e.source === "gesture" ? "Từ cử chỉ" : "Từ nút bấm"}
                  >
                    {e.source === "gesture" ? (
                      <HandTap size={14} />
                    ) : (
                      <Cursor size={14} />
                    )}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
