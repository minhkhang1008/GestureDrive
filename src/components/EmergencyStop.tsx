import { ArrowCounterClockwise, WarningOctagon } from "@phosphor-icons/react";

export function EmergencyStop({
  latched,
  resetting,
  canReset,
  onEstop,
  onReset,
}: {
  latched: boolean;
  resetting: boolean;
  canReset: boolean;
  onEstop: () => void;
  onReset: () => void;
}) {
  return (
    <section
      className={`rounded-[var(--radius-panel)] border p-3 ${
        latched ? "border-stop/70 bg-stop/12" : "border-stop/30 bg-surface"
      }`}
      aria-live="assertive"
    >
      <button
        type="button"
        onClick={onEstop}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-stop px-4 py-3 text-[13px] font-bold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
      >
        <WarningOctagon size={19} weight="fill" />
        E-STOP <span className="font-mono text-[11px] font-medium opacity-80">ESC</span>
      </button>

      {latched && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-snug text-stop">
            Đã khóa. Xe chỉ nhận STOP cho đến khi reset rõ ràng.
          </p>
          <button
            type="button"
            onClick={onReset}
            disabled={!canReset || resetting}
            className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-stop/40 px-3 py-2 text-[11px] font-semibold text-stop transition-[background-color,transform] hover:bg-stop/10 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
            title={canReset ? undefined : "Kết nối ESP1 trước khi reset E-stop"}
          >
            <ArrowCounterClockwise size={14} />
            {resetting ? "Đang reset" : "Arm / Reset"}
          </button>
        </div>
      )}
    </section>
  );
}
