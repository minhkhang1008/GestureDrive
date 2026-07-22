import {
  ArrowsOutCardinal,
  HandFist,
  HandPalm,
  LockSimple,
} from "@phosphor-icons/react";
import { COMMAND_ORDER, COMMANDS } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";

export function GestureLegend() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="mb-3 text-[12px] font-medium text-dim">Quy trình cử chỉ</p>

      <div className="grid gap-2">
        <div className="flex items-start gap-3 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <HandPalm size={15} weight="bold" />
          </span>
          <p className="text-[11px] leading-relaxed text-dim">
            <span className="font-medium text-ink">Xác nhận vai trò:</span> tay xòe điều
            hướng, tay nắm điều khiển tốc độ.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <ArrowsOutCardinal size={15} weight="bold" />
          </span>
          <p className="text-[11px] leading-relaxed text-dim">
            <span className="font-medium text-ink">Điều hướng:</span> di chuyển tay khỏi
            tâm. Nửa trên dùng lòng bàn tay, nửa dưới dùng mu bàn tay.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2.5">
          <span className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <HandFist size={15} weight="bold" />
            <LockSimple size={8} weight="fill" className="absolute bottom-0.5 right-0.5" />
          </span>
          <p className="text-[11px] leading-relaxed text-dim">
            <span className="font-medium text-ink">Tốc độ:</span> chỉ duỗi ngón trỏ và
            ngón cái để kéo. Thu ngón cái để khóa mức hiện tại.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-9 gap-1" aria-label="Chín vùng điều hướng">
        {COMMAND_ORDER.map((code) => (
          <span
            key={code}
            title={COMMANDS[code].label}
            className={`grid aspect-square place-items-center rounded-md ${
              code === "S" ? "bg-stop/12 text-stop" : "bg-accent/12 text-accent"
            }`}
          >
            <CommandGlyph code={code} size={13} />
          </span>
        ))}
      </div>
    </div>
  );
}
