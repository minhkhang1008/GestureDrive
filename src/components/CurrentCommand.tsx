import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, WifiSlash, Repeat } from "@phosphor-icons/react";
import { COMMANDS, type CommandCode } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";
import type { Mode } from "./ModeToggle";

export function CurrentCommand({
  current,
  previous,
  mode,
  holding,
  linked,
  pulseKey,
}: {
  current: CommandCode | null;
  previous: CommandCode | null;
  mode: Mode;
  holding: boolean;
  linked: boolean;
  pulseKey: number;
}) {
  const reduce = useReducedMotion();
  const cmd = current ? COMMANDS[current] : null;
  const isStop = current === "S";
  const tile = isStop ? "bg-stop/12 text-stop" : "bg-accent/12 text-accent";
  const ring = isStop ? "border-stop/50" : "border-accent/50";

  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="mb-4 text-[12px] font-medium text-dim">Lệnh hiện tại</p>

      <div className="flex items-center gap-4">
        <div className={`relative grid size-20 place-items-center rounded-2xl border ${ring} ${tile}`}>
          {!reduce && (
            <motion.span
              key={pulseKey}
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 1.35 }}
              transition={{ duration: 0.5 }}
              className={`absolute inset-0 rounded-2xl border ${ring}`}
            />
          )}
          <AnimatePresence mode="popLayout">
            <motion.span
              key={current ?? "none"}
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              {cmd ? (
                <CommandGlyph code={cmd.code} size={40} weight="bold" />
              ) : (
                <span className="text-2xl font-semibold text-faint">–</span>
              )}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-semibold leading-tight text-ink">
            {cmd ? cmd.label : "Chưa có lệnh"}
          </p>
          <p className="text-[13px] text-faint">
            {cmd ? `${cmd.english} · ${cmd.motor}` : "Đang chờ tín hiệu"}
          </p>

          <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
            {!linked ? (
              <span className="flex items-center gap-1.5 text-faint">
                <WifiSlash size={14} /> Chưa kết nối ESP32
              </span>
            ) : cmd ? (
              <span className="flex items-center gap-1.5 font-medium text-ok">
                <Check size={14} weight="bold" /> Đã gửi qua Bluetooth
              </span>
            ) : (
              <span className="text-faint">Sẵn sàng nhận lệnh</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[12px] text-faint">
          Lệnh trước:{" "}
          <span className="font-mono text-dim">
            {previous ? `${previous} · ${COMMANDS[previous].label}` : "chưa có"}
          </span>
        </span>
        {mode === "AUTO" && holding && (
          <span className="flex items-center gap-1 text-[11px] text-faint">
            <Repeat size={12} /> Giữ lệnh, bỏ qua khung trùng
          </span>
        )}
      </div>
    </div>
  );
}
