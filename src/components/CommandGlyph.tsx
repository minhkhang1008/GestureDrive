import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  HandPalm,
  type Icon,
} from "@phosphor-icons/react";
import type { CommandCode } from "../lib/commands";

const ICONS: Record<CommandCode, Icon> = {
  F: ArrowUp,
  B: ArrowDown,
  L: ArrowLeft,
  R: ArrowRight,
  S: HandPalm,
};

export function CommandGlyph({
  code,
  size = 24,
  weight = "bold",
}: {
  code: CommandCode;
  size?: number;
  weight?: "regular" | "bold" | "fill";
}) {
  const Ico = ICONS[code];
  return <Ico size={size} weight={weight} />;
}
