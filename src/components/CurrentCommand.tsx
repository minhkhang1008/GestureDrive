import { Gauge, HandPalm, LockSimple, WarningOctagon } from "@phosphor-icons/react";
import {
  FIRMWARE_K_TURN,
  FIRMWARE_MAX_PWM,
  applyOutputLimit,
  mixDifferentialDrive,
  scaleDriveOutput,
} from "../lib/driveMixer";
import {
  COMMAND_FLAG,
  COMMAND_TYPE,
  commandTypeName,
  type ControlCommand,
  type ControlMode,
} from "../lib/controlTypes";

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function outputPreview(command: ControlCommand): { left: number; right: number } {
  // Mirror the full ESP2 chain: mix with the firmware turn gain, scale by the
  // packet speed limit, then clamp with the bench MAX_PWM ceiling so the
  // preview never promises output the vehicle will refuse to drive.
  if (command.type === COMMAND_TYPE.DRIVE) {
    return applyOutputLimit(
      scaleDriveOutput(
        mixDifferentialDrive(command.channelA, command.channelB, FIRMWARE_K_TURN),
        command.speedLimit,
      ),
      FIRMWARE_MAX_PWM,
    );
  }
  if (command.type === COMMAND_TYPE.DIRECT_PWM) {
    return applyOutputLimit(
      applyOutputLimit(
        { left: command.channelA, right: command.channelB },
        command.speedLimit,
      ),
      FIRMWARE_MAX_PWM,
    );
  }
  return { left: 0, right: 0 };
}

function ChannelValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <span className="text-[10px] text-faint">{label}</span>
      <p className="font-mono text-[13px] text-ink">
        {signed(value)} <span className="text-[10px] text-faint">({signed(Math.round(value / 10))}%)</span>
      </p>
    </div>
  );
}

export function CurrentCommand({
  current,
  previous,
  label,
  previousLabel,
  mode,
  sequence,
  estopLatched,
}: {
  current: ControlCommand;
  previous: ControlCommand | null;
  label: string;
  previousLabel: string | null;
  mode: ControlMode;
  sequence: number | null;
  estopLatched: boolean;
}) {
  const preview = outputPreview(current);
  const stop = current.type === COMMAND_TYPE.STOP;
  const estop = Boolean(current.flags & COMMAND_FLAG.ESTOP) || estopLatched;
  const channelNames: [string, string] =
    current.type === COMMAND_TYPE.DRIVE
      ? ["Throttle (A)", "Steering (B)"]
      : current.type === COMMAND_TYPE.DIRECT_PWM
        ? ["Motor trái (A)", "Motor phải (B)"]
        : ["Channel A", "Channel B"];

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-live="polite">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-medium text-dim">Lệnh hiện tại</h2>
          <p className="mt-0.5 font-mono text-[10px] text-faint">
            {mode} / seq {sequence ?? "N/A"}
          </p>
        </div>
        <span
          className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] font-semibold ${
            estop
              ? "border-stop/50 bg-stop/15 text-stop"
              : stop
                ? "border-line-strong bg-surface-2 text-dim"
                : "border-accent/40 bg-accent/10 text-accent"
          }`}
        >
          {estop ? "E-STOP" : commandTypeName(current.type)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span
          className={`grid size-16 shrink-0 place-items-center rounded-2xl border ${
            estop
              ? "border-stop/60 bg-stop/15 text-stop"
              : stop
                ? "border-line-strong bg-surface-2 text-dim"
                : "border-accent/50 bg-accent/12 text-accent"
          }`}
        >
          {estop ? <WarningOctagon size={30} weight="fill" /> : <HandPalm size={30} weight={stop ? "regular" : "bold"} />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-ink">{label}</p>
          <p className="mt-1 text-[11px] text-faint">
            Limit {current.speedLimit} / flags 0x{current.flags.toString(16).toUpperCase().padStart(2, "0")}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-dim">
            {current.flags & COMMAND_FLAG.SPEED_LOCKED ? <LockSimple size={12} /> : <Gauge size={12} />}
            Output L {signed(preview.left)} / R {signed(preview.right)}
            <span className="text-[10px] text-faint">
              ước tính sau MAX_PWM {FIRMWARE_MAX_PWM}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3">
        <ChannelValue label={channelNames[0]} value={current.channelA} />
        <ChannelValue label={channelNames[1]} value={current.channelB} />
      </div>

      <p className="mt-3 truncate text-[10px] text-faint">
        Trước: {previous ? `${previousLabel ?? commandTypeName(previous.type)} / A ${signed(previous.channelA)} / B ${signed(previous.channelB)}` : "chưa có"}
      </p>
    </section>
  );
}
