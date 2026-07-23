import { Gauge, Pulse, Stop, Warning } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

interface DirectAction {
  label: string;
  left: number;
  right: number;
}

function DeadmanButton({
  action,
  onStart,
  onStop,
}: {
  action: DirectAction;
  onStart: (action: DirectAction) => void;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart(action);
      }}
      onPointerUp={onStop}
      onPointerCancel={onStop}
      onPointerLeave={onStop}
      onContextMenu={(event) => event.preventDefault()}
      className="min-h-14 touch-none select-none rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-left transition-[background-color,border-color,transform] hover:border-line-strong hover:bg-line active:scale-[0.98]"
    >
      <span className="block text-[12px] font-semibold text-ink">{action.label}</span>
      <span className="mt-1 block font-mono text-[10px] text-faint">
        L {action.left > 0 ? "+" : ""}{action.left} / R {action.right > 0 ? "+" : ""}{action.right}
      </span>
    </button>
  );
}

function MotorSlider({
  name,
  value,
  packetValue,
  onChange,
  onStop,
}: {
  name: string;
  value: number;
  packetValue: number;
  onChange: (value: number) => void;
  onStop: () => void;
}) {
  return (
    <label className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-4">
      <span className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-dim">{name}</span>
        <span className="font-mono text-[11px] text-ink">
          {value > 0 ? "+" : ""}{value}% / {packetValue > 0 ? "+" : ""}{packetValue}
        </span>
      </span>
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        value={value}
        onChange={(event) => {
          onStop();
          onChange(Number(event.target.value));
        }}
        className="mt-4 w-full accent-accent"
        aria-label={`${name}, âm là lùi và dương là tiến`}
      />
      <span className="mt-2 flex justify-between font-mono text-[9px] text-faint">
        <span>-100%</span><span>STOP</span><span>+100%</span>
      </span>
    </label>
  );
}

export function CalibrationPanel({
  safetyLimitPercent,
  onSafetyLimitChange,
  onDirectStart,
  onStop,
  onPulse,
}: {
  safetyLimitPercent: number;
  onSafetyLimitChange: (percent: number) => void;
  onDirectStart: (left: number, right: number, label: string) => void;
  onStop: () => void;
  onPulse: (left: number, right: number, durationMs: number, label: string) => void;
}) {
  const [leftPercent, setLeftPercent] = useState(0);
  const [rightPercent, setRightPercent] = useState(0);
  const [pulseDuration, setPulseDuration] = useState(500);
  const limit = safetyLimitPercent * 10;
  const toPacket = (percent: number) =>
    Math.max(-limit, Math.min(limit, Math.round(percent * 10)));
  const leftPacket = toPacket(leftPercent);
  const rightPacket = toPacket(rightPercent);

  const actions = useMemo<DirectAction[]>(
    () => [
      { label: "Chỉ motor trái tiến", left: limit, right: 0 },
      { label: "Chỉ motor trái lùi", left: -limit, right: 0 },
      { label: "Chỉ motor phải tiến", left: 0, right: limit },
      { label: "Chỉ motor phải lùi", left: 0, right: -limit },
      { label: "Hai motor tiến", left: limit, right: limit },
      { label: "Hai motor lùi", left: -limit, right: -limit },
      { label: "Pivot trái", left: -limit, right: limit },
      { label: "Pivot phải", left: limit, right: -limit },
    ],
    [limit],
  );

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[17px] font-semibold text-ink">Hiệu chỉnh motor độc lập</h1>
          <p className="mt-1 max-w-[68ch] text-[12px] leading-relaxed text-dim">
            Slider chỉ đặt giá trị. Motor chỉ chạy khi giữ nút áp dụng hoặc khi chạy xung có thời hạn.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-dim">
            <Gauge size={14} /> Safety limit
          </span>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={safetyLimitPercent}
            onChange={(event) => {
              onStop();
              onSafetyLimitChange(Number(event.target.value));
            }}
            aria-label="Giới hạn an toàn calibration"
            className="w-24 accent-accent"
          />
          <span className={`w-9 font-mono text-[11px] ${safetyLimitPercent > 60 ? "text-stop" : "text-accent"}`}>
            {safetyLimitPercent}%
          </span>
        </label>
      </div>

      {safetyLimitPercent > 60 && (
        <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-stop/40 bg-stop/10 px-3 py-2 text-[11px] text-stop">
          <Warning size={15} className="mt-0.5 shrink-0" />
          Giới hạn đang cao hơn mức thử bàn mặc định 60%. Chỉ tăng sau khi đã đo ngưỡng an toàn.
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <MotorSlider
          name="Motor trái"
          value={leftPercent}
          packetValue={leftPacket}
          onChange={setLeftPercent}
          onStop={onStop}
        />
        <MotorSlider
          name="Motor phải"
          value={rightPercent}
          packetValue={rightPacket}
          onChange={setRightPercent}
          onStop={onStop}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <button
          type="button"
          disabled={leftPacket === 0 && rightPacket === 0}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onDirectStart(leftPacket, rightPacket, "Giữ giá trị hai slider");
          }}
          onPointerUp={onStop}
          onPointerCancel={onStop}
          onPointerLeave={onStop}
          className="min-h-12 touch-none select-none rounded-[var(--radius-control)] bg-accent-strong px-4 py-2 text-[12px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Giữ để áp dụng hai slider
        </button>
        <button
          type="button"
          onClick={() => {
            setLeftPercent(0);
            setRightPercent(0);
            onStop();
          }}
          className="flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-stop/40 px-4 py-2 text-[12px] font-semibold text-stop transition-[background-color,transform] hover:bg-stop/10 active:scale-[0.98]"
        >
          <Stop size={15} weight="fill" /> STOP và về 0
        </button>
      </div>

      <div className="mt-6">
        <h2 className="text-[12px] font-medium text-dim">Nút thử nhanh, luôn dead-man</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((action) => (
            <DeadmanButton
              key={action.label}
              action={action}
              onStart={(selected) => onDirectStart(selected.left, selected.right, selected.label)}
              onStop={onStop}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-[var(--radius-control)] border border-line bg-surface-2 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Pulse size={15} className="text-accent" /> Timed pulse
            </h2>
            <p className="mt-1 text-[10px] text-faint">Chạy giá trị slider rồi tự STOP.</p>
          </div>
          <div className="flex gap-2">
            <select
              value={pulseDuration}
              onChange={(event) => setPulseDuration(Number(event.target.value))}
              className="rounded-[var(--radius-control)] border border-line bg-bg px-3 py-2 font-mono text-[11px] text-ink"
              aria-label="Thời lượng timed pulse"
            >
              {[250, 500, 1000, 2000].map((duration) => (
                <option key={duration} value={duration}>{duration} ms</option>
              ))}
            </select>
            <button
              type="button"
              disabled={leftPacket === 0 && rightPacket === 0}
              onClick={() =>
                onPulse(leftPacket, rightPacket, pulseDuration, `Timed pulse ${pulseDuration} ms`)
              }
              className="rounded-[var(--radius-control)] border border-accent/50 bg-accent/10 px-4 py-2 text-[11px] font-semibold text-accent transition-[background-color,transform] hover:bg-accent/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Chạy xung
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
