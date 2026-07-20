import { HandPalm } from "@phosphor-icons/react";
import { COMMAND_ORDER, COMMANDS } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";

export function GestureLegend() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="mb-3 text-[12px] font-medium text-dim">Bảng cử chỉ</p>
      <ul className="flex flex-col gap-1">
        {COMMAND_ORDER.map((code) => {
          const cmd = COMMANDS[code];
          const isStop = code === "S";
          return (
            <li
              key={code}
              className="flex items-center gap-3 rounded-lg px-1.5 py-1.5"
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-md ${
                  isStop ? "bg-stop/15 text-stop" : "bg-accent/15 text-accent"
                }`}
              >
                {isStop ? (
                  <HandPalm size={15} weight="bold" />
                ) : (
                  <CommandGlyph code={code} size={15} />
                )}
              </span>
              <span className="w-16 shrink-0 text-[13px] font-medium text-ink">
                {cmd.label}
              </span>
              <span className="flex-1 text-[12px] text-faint">{cmd.gesture}</span>
              <span className="font-mono text-[11px] text-dim">{code}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
