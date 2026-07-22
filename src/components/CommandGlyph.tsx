import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  HandPalm,
  type Icon,
} from "@phosphor-icons/react";
import type { DirectionCode } from "../lib/commands";

const ICONS: Record<DirectionCode, Icon> = {
  F: ArrowUp,
  B: ArrowDown,
  L: ArrowLeft,
  R: ArrowRight,
  FL: ArrowUpLeft,
  FR: ArrowUpRight,
  BL: ArrowDownLeft,
  BR: ArrowDownRight,
  S: HandPalm,
};

export function CommandGlyph({
  code,
  size = 24,
  weight = "bold",
}: {
  code: DirectionCode;
  size?: number;
  weight?: "regular" | "bold" | "fill";
}) {
  const Ico = ICONS[code];
  return <Ico size={size} weight={weight} />;
}
