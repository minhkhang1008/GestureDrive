import type { DirectionCode } from "./commands";

// A MediaPipe hand landmark. Coordinates are normalized to 0..1.
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Handedness = "Left" | "Right";
export type ScreenSide = "left" | "right";
export type SetupPose = "open" | "fist" | "other";
export type SpeedGestureState = "adjusting" | "locked" | "invalid";

export interface Point {
  x: number;
  y: number;
}

export interface DirectionResult {
  code: DirectionCode | null;
  name: string;
  orientationValid: boolean;
}

export interface SpeedGestureResult {
  state: SpeedGestureState;
  value: number | null;
  fingers: boolean[];
  pinchRatio: number;
}

const WRIST = 0;
const MCP = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 };
const PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };
const DIP = { index: 7, middle: 11, ring: 15, pinky: 19 };
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };

// Small enough to ignore tremor without making the joystick feel sluggish.
export const DIRECTION_DEAD_ZONE = 0.035;
export const SPEED_TOP = 0.14;
export const SPEED_BOTTOM = 0.86;
export const PINCH_ENTER_RATIO = 0.42;
export const PINCH_EXIT_RATIO = 0.56;

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const lengths = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);
  if (lengths === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI;
}

function fingerExtended(
  lm: Landmark[],
  mcp: number,
  pip: number,
  dip: number,
  tip: number,
): boolean {
  return (
    jointAngle(lm[mcp], lm[pip], lm[dip]) > 150 &&
    jointAngle(lm[pip], lm[dip], lm[tip]) > 145 &&
    distance(lm[tip], lm[WRIST]) > distance(lm[pip], lm[WRIST]) * 1.08
  );
}

/** Rotation-resistant finger state: [thumb, index, middle, ring, pinky]. */
export function fingersUp(lm: Landmark[], _handedness: Handedness): boolean[] {
  const thumb =
    jointAngle(lm[MCP.thumb], lm[3], lm[TIP.thumb]) > 145 &&
    distance(lm[TIP.thumb], lm[MCP.index]) > distance(lm[3], lm[MCP.index]) * 1.08;
  const index = fingerExtended(lm, MCP.index, PIP.index, DIP.index, TIP.index);
  const middle = fingerExtended(lm, MCP.middle, PIP.middle, DIP.middle, TIP.middle);
  const ring = fingerExtended(lm, MCP.ring, PIP.ring, DIP.ring, TIP.ring);
  const pinky = fingerExtended(lm, MCP.pinky, PIP.pinky, DIP.pinky, TIP.pinky);
  return [thumb, index, middle, ring, pinky];
}

export function recognizeSetupPose(
  lm: Landmark[],
  handedness: Handedness,
): SetupPose {
  const [, index, middle, ring, pinky] = fingersUp(lm, handedness);
  const longFingerCount = [index, middle, ring, pinky].filter(Boolean).length;
  // Ignore the thumb during role setup. Its state is much more sensitive to
  // camera angle, while the four long fingers clearly distinguish open/fist.
  if (longFingerCount === 4) return "open";
  if (longFingerCount === 0) return "fist";
  return "other";
}

/** Point is returned in the mirrored, user-facing camera coordinate system. */
export function palmCenter(lm: Landmark[]): Point {
  const indices = [WRIST, MCP.index, MCP.middle, MCP.ring, MCP.pinky];
  const raw = indices.reduce(
    (sum, index) => ({ x: sum.x + lm[index].x, y: sum.y + lm[index].y }),
    { x: 0, y: 0 },
  );
  return { x: 1 - raw.x / indices.length, y: raw.y / indices.length };
}

export function screenSide(point: Point): ScreenSide {
  return point.x < 0.5 ? "left" : "right";
}

/**
 * Determine whether the palm, rather than the back of the hand, faces the
 * camera. MediaPipe handedness is evaluated on the unmirrored input frame.
 */
export function palmFacesCamera(lm: Landmark[], handedness: Handedness): boolean {
  return handedness === "Right"
    ? lm[MCP.index].x < lm[MCP.pinky].x
    : lm[MCP.index].x > lm[MCP.pinky].x;
}

function sectorFromVector(dx: number, dy: number): DirectionCode {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle >= -22.5 && angle < 22.5) return "R";
  if (angle >= 22.5 && angle < 67.5) return "BR";
  if (angle >= 67.5 && angle < 112.5) return "B";
  if (angle >= 112.5 && angle < 157.5) return "BL";
  if (angle >= 157.5 || angle < -157.5) return "L";
  if (angle >= -157.5 && angle < -112.5) return "FL";
  if (angle >= -112.5 && angle < -67.5) return "F";
  return "FR";
}

const DIRECTION_NAMES: Record<DirectionCode, string> = {
  F: "Đi thẳng",
  B: "Đi lùi",
  L: "Quay trái",
  R: "Quay phải",
  FL: "Chếch trái",
  FR: "Chếch phải",
  BL: "Lùi chếch trái",
  BR: "Lùi chếch phải",
  S: "Vùng dừng",
};

export function recognizeDirection(
  lm: Landmark[],
  handedness: Handedness,
  anchor: Point,
): DirectionResult {
  const center = palmCenter(lm);
  const dx = center.x - anchor.x;
  const dy = center.y - anchor.y;
  if (Math.hypot(dx, dy) <= DIRECTION_DEAD_ZONE) {
    return { code: "S", name: DIRECTION_NAMES.S, orientationValid: true };
  }

  const code = sectorFromVector(dx, dy);
  const palmForward = palmFacesCamera(lm, handedness);
  const upper = code === "F" || code === "FL" || code === "FR";
  const lower = code === "B" || code === "BL" || code === "BR";
  const orientationValid = (!upper || palmForward) && (!lower || !palmForward);

  if (!orientationValid) {
    return {
      code: null,
      name: upper ? "Hướng lòng bàn tay vào camera" : "Hướng mu bàn tay vào camera",
      orientationValid: false,
    };
  }

  return { code, name: DIRECTION_NAMES[code], orientationValid: true };
}

export function speedFromY(y: number): number {
  const normalized = (SPEED_BOTTOM - y) / (SPEED_BOTTOM - SPEED_TOP);
  return Math.round(Math.min(1, Math.max(0, normalized)) * 1000);
}

export function normalizedPinchDistance(lm: Landmark[]): number {
  const palmScale = Math.max(
    distance(lm[WRIST], lm[MCP.middle]),
    distance(lm[MCP.index], lm[MCP.pinky]),
    0.001,
  );
  return distance(lm[TIP.thumb], lm[TIP.index]) / palmScale;
}

export function recognizeSpeedGesture(
  lm: Landmark[],
  handedness: Handedness,
  wasAdjusting = false,
): SpeedGestureResult {
  const fingers = fingersUp(lm, handedness);
  const [, , middle, ring, pinky] = fingers;
  const supportingFingerCount = [middle, ring, pinky].filter(Boolean).length;
  const pinchRatio = normalizedPinchDistance(lm);
  const pinchThreshold = wasAdjusting ? PINCH_EXIT_RATIO : PINCH_ENTER_RATIO;

  // The speed hand acts like a draggable slider:
  // thumb-index pinch = grab and adjust, release = lock the current value.
  // Requiring two supporting fingers to remain open avoids confusing a fist
  // or an accidental finger crossing with a speed command.
  if (supportingFingerCount >= 2 && pinchRatio <= pinchThreshold) {
    const pinchY = (lm[TIP.thumb].y + lm[TIP.index].y) / 2;
    return {
      state: "adjusting",
      value: speedFromY(pinchY),
      fingers,
      pinchRatio,
    };
  }
  if (supportingFingerCount >= 2) {
    return { state: "locked", value: null, fingers, pinchRatio };
  }
  return { state: "invalid", value: null, fingers, pinchRatio };
}

export function handSpan(lm: Landmark[]): number {
  return distance(lm[WRIST], lm[TIP.middle]);
}

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
