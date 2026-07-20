import { HandPalm } from "@phosphor-icons/react";
import { CommandGlyph } from "./CommandGlyph";
import { COMMANDS, type CommandCode } from "../lib/commands";

const KEY_HINT: Record<CommandCode, string> = {
  F: "W",
  B: "S",
  L: "A",
  R: "D",
  S: "Space",
};

function PadKey({
  code,
  active,
  onPress,
  className = "",
}: {
  code: CommandCode;
  active: boolean;
  onPress: (c: CommandCode) => void;
  className?: string;
}) {
  const isStop = code === "S";
  const base =
    "group flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border transition-all active:scale-[0.94] select-none";
  const palette = isStop
    ? active
      ? "border-stop/60 bg-stop/20 text-stop"
      : "border-line bg-surface-2 text-stop/80 hover:border-stop/40"
    : active
      ? "border-accent/60 bg-accent/20 text-accent"
      : "border-line bg-surface-2 text-dim hover:border-line-strong hover:text-ink";

  return (
    <button
      onPointerDown={() => onPress(code)}
      aria-label={`${COMMANDS[code].label} (${KEY_HINT[code]})`}
      className={`${base} ${palette} ${className}`}
    >
      {isStop ? (
        <HandPalm size={22} weight={active ? "fill" : "bold"} />
      ) : (
        <CommandGlyph code={code} size={22} />
      )}
      <span className="font-mono text-[10px] opacity-70">{KEY_HINT[code]}</span>
    </button>
  );
}

export function ManualPad({
  active,
  onCommand,
}: {
  active: CommandCode | null;
  onCommand: (c: CommandCode) => void;
}) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="mb-4 text-[12px] font-medium text-dim">Bàn phím điều khiển</p>

      <div className="mx-auto grid max-w-[248px] grid-cols-3 gap-2">
        <span />
        <PadKey code="F" active={active === "F"} onPress={onCommand} />
        <span />
        <PadKey code="L" active={active === "L"} onPress={onCommand} />
        <PadKey code="S" active={active === "S"} onPress={onCommand} />
        <PadKey code="R" active={active === "R"} onPress={onCommand} />
        <span />
        <PadKey code="B" active={active === "B"} onPress={onCommand} />
        <span />
      </div>

      <p className="mt-4 text-center text-[12px] text-faint">
        Bấm nút hoặc dùng phím W A S D, Space để dừng.
      </p>
    </div>
  );
}
