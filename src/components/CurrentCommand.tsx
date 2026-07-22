import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Bluetooth,
  Broadcast,
  Gauge,
  Hourglass,
  LockSimple,
  Repeat,
  Warning,
  WifiSlash,
} from "@phosphor-icons/react";
import { COMMANDS, type DriveCommand } from "../lib/commands";
import type { WirelessTransport } from "../hooks/useSerialConnection";
import { CommandGlyph } from "./CommandGlyph";
import type { Mode } from "./ModeToggle";

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function LinkFeedback({
  connected,
  transport,
}: {
  connected: boolean;
  transport: WirelessTransport;
}) {
  if (!connected) {
    return (
      <span className="flex items-center gap-1.5 text-faint">
        <WifiSlash size={14} /> Chưa kết nối ESP1
      </span>
    );
  }
  if (transport === "esp-now") {
    return (
      <span className="flex items-center gap-1.5 font-medium text-ok">
        <Broadcast size={14} weight="bold" /> ESP-NOW đang hoạt động
      </span>
    );
  }
  if (transport === "bluetooth") {
    return (
      <span className="flex items-center gap-1.5 font-medium text-accent">
        <Bluetooth size={14} weight="bold" /> Bluetooth dự phòng
      </span>
    );
  }
  if (transport === "none") {
    return (
      <span className="flex items-center gap-1.5 text-stop">
        <Warning size={14} weight="bold" /> Chưa có đường truyền tới ESP2
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-faint">
      <Hourglass size={14} /> Đang kiểm tra kết nối ESP2
    </span>
  );
}

export function CurrentCommand({
  current,
  previous,
  mode,
  holding,
  connected,
  transport,
  pulseKey,
}: {
  current: DriveCommand | null;
  previous: DriveCommand | null;
  mode: Mode;
  holding: boolean;
  connected: boolean;
  transport: WirelessTransport;
  pulseKey: number;
}) {
  const reduce = useReducedMotion();
  const definition = current ? COMMANDS[current.code] : null;
  const isStop = current && current.leftMotor === 0 && current.rightMotor === 0;
  const tile = !current
    ? "bg-surface-2 text-faint"
    : isStop
      ? "bg-stop/12 text-stop"
      : "bg-accent/12 text-accent";
  const ring = !current
    ? "border-line-strong"
    : isStop
      ? "border-stop/50"
      : "border-accent/50";

  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12px] font-medium text-dim">Tín hiệu điều khiển</p>
        {current && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-dim">
            {current.speedLocked ? <LockSimple size={12} /> : <Gauge size={12} />}
            PWM {current.speed}
          </span>
        )}
      </div>

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
              key={current?.code ?? "none"}
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              {current ? (
                <CommandGlyph code={current.code} size={40} weight="bold" />
              ) : (
                <span className="text-2xl font-semibold text-faint">-</span>
              )}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-semibold leading-tight text-ink">
            {definition ? definition.label : "Chưa có tín hiệu"}
          </p>
          <p className="mt-1 text-[12px] text-faint">
            {definition ? definition.motor : "Đang chờ camera hoặc bàn phím"}
          </p>
          <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
            <LinkFeedback connected={connected} transport={transport} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3">
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-[10px] text-faint">Motor trái</span>
          <p className="font-mono text-[13px] text-ink">
            {current ? signed(current.leftMotor) : "0"}
          </p>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-[10px] text-faint">Motor phải</span>
          <p className="font-mono text-[13px] text-ink">
            {current ? signed(current.rightMotor) : "0"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-faint">
        <span className="truncate">
          Trước: {previous ? `${previous.code}, PWM ${previous.speed}` : "chưa có"}
        </span>
        {mode === "AUTO" && holding && (
          <span className="flex shrink-0 items-center gap-1">
            <Repeat size={12} /> Đang giữ hướng
          </span>
        )}
      </div>
    </div>
  );
}
