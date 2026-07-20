import type { CommandCode } from "./commands";

// A single MediaPipe hand landmark (normalized 0..1, origin top-left, x grows right).
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// Landmark indices per MediaPipe Hands topology.
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };
const MCP = { thumb: 2, index: 5 };
const WRIST = 0;

/**
 * Which fingers are extended: [thumb, index, middle, ring, pinky].
 * Fingers use the tip-above-pip test (screen y grows downward).
 * Thumb uses a sideways test relative to the hand's own axis so it works
 * for either hand and rotation.
 */
export function fingersUp(lm: Landmark[], handedness: "Left" | "Right"): boolean[] {
  const index = lm[TIP.index].y < lm[PIP.index].y;
  const middle = lm[TIP.middle].y < lm[PIP.middle].y;
  const ring = lm[TIP.ring].y < lm[PIP.ring].y;
  const pinky = lm[TIP.pinky].y < lm[PIP.pinky].y;

  // Thumb points outward horizontally. On a mirrored selfie view the sign of
  // "outward" flips with handedness.
  const thumbTip = lm[TIP.thumb];
  const thumbMcp = lm[MCP.thumb];
  const thumb =
    handedness === "Right"
      ? thumbTip.x < thumbMcp.x
      : thumbTip.x > thumbMcp.x;

  return [thumb, index, middle, ring, pinky];
}

export interface GestureResult {
  code: CommandCode | null;
  fingers: boolean[];
  name: string;
}

/**
 * Map a hand pose to one command character.
 * This scheme is intentionally simple and swappable. Agree the final mapping
 * with the AI recognition team; only the body of this function needs to change.
 */
export function recognizeGesture(
  lm: Landmark[],
  handedness: "Left" | "Right",
): GestureResult {
  const fingers = fingersUp(lm, handedness);
  const count = fingers.filter(Boolean).length;
  const [, index, middle, ring, pinky] = fingers;

  // Fist -> Stop
  if (count === 0) return { code: "S", fingers, name: "Nắm tay" };

  // Open palm -> Forward
  if (count === 5) return { code: "F", fingers, name: "Xòe bàn tay" };

  // Four fingers, thumb tucked -> Backward
  if (index && middle && ring && pinky && count === 4)
    return { code: "B", fingers, name: "Bốn ngón" };

  // Index only -> turn, direction from where the finger points.
  if (index && !middle && !ring && !pinky) {
    const dx = lm[TIP.index].x - lm[MCP.index].x;
    if (dx < -0.04) return { code: "L", fingers, name: "Chỉ sang trái" };
    if (dx > 0.04) return { code: "R", fingers, name: "Chỉ sang phải" };
    return { code: null, fingers, name: "Ngón trỏ (giữ thẳng)" };
  }

  return { code: null, fingers, name: "Không rõ" };
}

// Convenience: hand size in normalized units, used to scale overlay strokes.
export function handSpan(lm: Landmark[]): number {
  const w = lm[WRIST];
  const m = lm[TIP.middle];
  return Math.hypot(w.x - m.x, w.y - m.y);
}

// MediaPipe hand connections for drawing the skeleton.
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
