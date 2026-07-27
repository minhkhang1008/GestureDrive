import { COMMANDS, type DirectionCode } from "./commands";
import { clamp, hysteresisActive } from "./filters";

// A MediaPipe hand landmark. Coordinates are normalized to 0..1.
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Handedness = "Left" | "Right";
export type ScreenSide = "left" | "right";
export type SetupPose = "open" | "fist" | "other";
/**
 * "absent" is not a recognized pose — it is produced by the hook when the speed
 * hand is out of frame or not trusted, and means the locked value is being
 * held. recognizeSpeedPose never returns it.
 */
export type SpeedGestureState = "adjusting" | "locked" | "invalid" | "absent";
/** What recognizeSpeedPose can actually classify from landmarks. */
export type RecognizedSpeedPose = Exclude<SpeedGestureState, "absent">;
export type PalmOrientation = "palm" | "back";

export interface Point {
  x: number;
  y: number;
}

const WRIST = 0;
const MCP = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 };
const PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };
const DIP = { index: 7, middle: 11, ring: 15, pinky: 19 };
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };

// ---------------------------------------------------------------------------
// Tunable thresholds. Displacement thresholds are in "span units": planar
// distance divided by the palm scale, so every threshold is invariant to how
// far the hand sits from the camera.
// ---------------------------------------------------------------------------

/** Radial dead zone with hysteresis: enter driving above, drop below to stop. */
export const DEADZONE_ENTER_SPAN = 0.18;
export const DEADZONE_EXIT_SPAN = 0.12;
/** Displacement (span units) that maps to full 1000 deflection. */
export const FULL_DEFLECTION_SPAN = 1.1;
/** RC-style expo: finer control near center, full authority at the edge. */
export const DRIVE_EXPO = 0.3;
/** Angular hysteresis so the displayed sector does not flicker on boundaries. */
export const SECTOR_HYSTERESIS_DEG = 8;
/** Palm/back flip hysteresis, in span units of index-vs-pinky MCP offset. */
export const ORIENTATION_HYSTERESIS_SPAN = 0.06;
/** |throttle| above which the palm orientation gate applies. */
export const ORIENTATION_GATE_THROTTLE = 200;

export const PINCH_ENTER_RATIO = 0.42;
export const PINCH_EXIT_RATIO = 0.56;
/** Moving the pinch one hand-span vertically changes speed by this much. */
export const SPEED_DRAG_GAIN_PER_SPAN = 500;

/** Hands smaller than this (planar span units of palm scale) are unreliable. */
export const MIN_PALM_SCALE = 0.05;
export const MIN_HANDEDNESS_SCORE = 0.7;

// ---------------------------------------------------------------------------
// Coordinate space
//
// The hook mirrors every landmark once at ingestion (x -> 1 - x) so that all
// gesture math and all overlay drawing happen in the same mirrored,
// user-facing space the operator sees on screen. Handedness labels keep
// MediaPipe's original meaning.
//
// "Planar" space additionally multiplies x by the video aspect ratio so that
// distances are isotropic: one planar unit equals the frame height in both
// axes, and a circle in planar space is a circle on screen.
// ---------------------------------------------------------------------------

export function mirrorLandmarks(landmarks: Landmark[]): Landmark[] {
  return landmarks.map(({ x, y, z }) => ({ x: 1 - x, y, z }));
}

export function toPlanar(point: Point, aspect: number): Point {
  return { x: point.x * aspect, y: point.y };
}

function distance2D(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const lengths = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);
  if (lengths === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI;
}

function lm(landmarks: Landmark[], index: number): Landmark {
  const landmark = landmarks[index];
  if (!landmark) throw new Error(`Thiếu landmark ${index}`);
  return landmark;
}

/** Average of wrist and the four finger MCPs, in mirrored normalized space. */
export function palmCenter(landmarks: Landmark[]): Point {
  const indices = [WRIST, MCP.index, MCP.middle, MCP.ring, MCP.pinky];
  let x = 0;
  let y = 0;
  for (const index of indices) {
    x += lm(landmarks, index).x;
    y += lm(landmarks, index).y;
  }
  return { x: x / indices.length, y: y / indices.length };
}

export function screenSide(point: Point): ScreenSide {
  return point.x < 0.5 ? "left" : "right";
}

/**
 * Pose-invariant hand size reference: the palm itself, not the fingertips,
 * so the scale does not change between an open hand and a fist.
 */
export function palmScalePlanar(landmarks: Landmark[], aspect: number): number {
  return Math.max(
    distance2D(lm(landmarks, WRIST), lm(landmarks, MCP.middle), aspect),
    distance2D(lm(landmarks, MCP.index), lm(landmarks, MCP.pinky), aspect),
    0.001,
  );
}

/** Wrist to middle fingertip, for overlay line-width scaling only. */
export function handSpan(landmarks: Landmark[]): number {
  return distance2D(lm(landmarks, WRIST), lm(landmarks, TIP.middle), 1);
}

// ---------------------------------------------------------------------------
// Finger state with per-finger hysteresis
// ---------------------------------------------------------------------------

interface FingerGate {
  proximalAngle: number;
  distalAngle: number;
  lengthRatio: number;
}

const FINGER_ENTER: FingerGate = { proximalAngle: 150, distalAngle: 145, lengthRatio: 1.08 };
const FINGER_EXIT: FingerGate = { proximalAngle: 140, distalAngle: 135, lengthRatio: 1.02 };
const THUMB_ENTER = { angle: 145, lengthRatio: 1.08 };
const THUMB_EXIT = { angle: 135, lengthRatio: 1.02 };

function fingerExtended(
  landmarks: Landmark[],
  mcp: number,
  pip: number,
  dip: number,
  tip: number,
  wasExtended: boolean,
): boolean {
  const gate = wasExtended ? FINGER_EXIT : FINGER_ENTER;
  return (
    jointAngle(lm(landmarks, mcp), lm(landmarks, pip), lm(landmarks, dip)) >
      gate.proximalAngle &&
    jointAngle(lm(landmarks, pip), lm(landmarks, dip), lm(landmarks, tip)) >
      gate.distalAngle &&
    distance2D(lm(landmarks, tip), lm(landmarks, WRIST), 1) >
      distance2D(lm(landmarks, pip), lm(landmarks, WRIST), 1) * gate.lengthRatio
  );
}

/**
 * Rotation-resistant finger state: [thumb, index, middle, ring, pinky].
 * Passing the previous frame's result enables per-finger hysteresis so a
 * finger hovering near a threshold cannot flap between extended and curled.
 */
export function fingersUp(
  landmarks: Landmark[],
  previous: boolean[] | null = null,
): boolean[] {
  const thumbGate = previous?.[0] ? THUMB_EXIT : THUMB_ENTER;
  const thumb =
    jointAngle(lm(landmarks, MCP.thumb), lm(landmarks, 3), lm(landmarks, TIP.thumb)) >
      thumbGate.angle &&
    distance2D(lm(landmarks, TIP.thumb), lm(landmarks, MCP.index), 1) >
      distance2D(lm(landmarks, 3), lm(landmarks, MCP.index), 1) * thumbGate.lengthRatio;
  const index = fingerExtended(
    landmarks, MCP.index, PIP.index, DIP.index, TIP.index, previous?.[1] ?? false,
  );
  const middle = fingerExtended(
    landmarks, MCP.middle, PIP.middle, DIP.middle, TIP.middle, previous?.[2] ?? false,
  );
  const ring = fingerExtended(
    landmarks, MCP.ring, PIP.ring, DIP.ring, TIP.ring, previous?.[3] ?? false,
  );
  const pinky = fingerExtended(
    landmarks, MCP.pinky, PIP.pinky, DIP.pinky, TIP.pinky, previous?.[4] ?? false,
  );
  return [thumb, index, middle, ring, pinky];
}

export function recognizeSetupPose(fingers: boolean[]): SetupPose {
  const longFingerCount = fingers.slice(1).filter(Boolean).length;
  // Ignore the thumb during role setup. Its state is much more sensitive to
  // camera angle, while the four long fingers clearly distinguish open/fist.
  if (longFingerCount === 4) return "open";
  if (longFingerCount === 0) return "fist";
  return "other";
}

// ---------------------------------------------------------------------------
// Palm orientation with hysteresis
// ---------------------------------------------------------------------------

/**
 * Signed projection of the palm normal onto the camera axis, normalized by the
 * squared palm scale so it is invariant to distance. Positive means the palm
 * faces the camera, negative the back of the hand; the magnitude grows from 0
 * (hand exactly edge-on) toward ~1 (palm square to the camera).
 *
 * This is the 2D cross product of the wrist->index-MCP and wrist->pinky-MCP
 * vectors, i.e. twice the signed area of the palm triangle as projected on
 * screen. Unlike a plain index-vs-pinky x offset it does not depend on how the
 * hand is rotated in the image plane, so the forward/reverse gate keeps
 * working with the fingers pointing sideways or down.
 */
export function palmFacingSigned(
  landmarks: Landmark[],
  handedness: Handedness,
  aspect: number,
): number {
  const wrist = lm(landmarks, WRIST);
  const index = lm(landmarks, MCP.index);
  const pinky = lm(landmarks, MCP.pinky);
  const ax = (index.x - wrist.x) * aspect;
  const ay = index.y - wrist.y;
  const bx = (pinky.x - wrist.x) * aspect;
  const by = pinky.y - wrist.y;
  const cross = ax * by - ay * bx;
  const scale = palmScalePlanar(landmarks, aspect);
  // In mirrored space the palm triangle of a right hand facing the camera
  // winds clockwise (negative cross product); a left hand winds the other way.
  return (handedness === "Right" ? -cross : cross) / (scale * scale);
}

/**
 * Whether the palm or the back of the hand faces the camera, with hysteresis
 * so an edge-on hand does not flicker between the two. Works in the mirrored
 * space produced by mirrorLandmarks.
 */
export function resolvePalmOrientation(
  landmarks: Landmark[],
  handedness: Handedness,
  previous: PalmOrientation | null,
  aspect: number,
): PalmOrientation {
  const signed = palmFacingSigned(landmarks, handedness, aspect);
  if (previous === null) return signed >= 0 ? "palm" : "back";
  if (previous === "palm") {
    return signed < -ORIENTATION_HYSTERESIS_SPAN ? "back" : "palm";
  }
  return signed > ORIENTATION_HYSTERESIS_SPAN ? "palm" : "back";
}

// ---------------------------------------------------------------------------
// Analog drive from palm displacement
// ---------------------------------------------------------------------------

export interface AnalogDrive {
  /** False while inside the dead zone (with hysteresis). */
  active: boolean;
  /** -1000..1000, positive = forward. */
  throttle: number;
  /** -1000..1000, positive = turn left (matches the DRIVE protocol). */
  steering: number;
  /** Raw displacement magnitude in span units, before the dead zone. */
  magnitudeSpan: number;
  /** 0..1 deflection after dead zone removal and expo. */
  deflection: number;
}

export const IDLE_ANALOG_DRIVE: AnalogDrive = {
  active: false,
  throttle: 0,
  steering: 0,
  magnitudeSpan: 0,
  deflection: 0,
};

function expoCurve(value: number, expo: number): number {
  return (1 - expo) * value + expo * value ** 3;
}

/**
 * Map the span-normalized palm displacement (planar units / palm scale) to a
 * proportional throttle/steering pair. Screen up = forward, screen right =
 * turn right (negative steering).
 */
export function analogDriveFromVector(
  dxSpan: number,
  dySpan: number,
  wasActive: boolean,
): AnalogDrive {
  const magnitude = Math.hypot(dxSpan, dySpan);
  const active = hysteresisActive(
    magnitude, wasActive, DEADZONE_ENTER_SPAN, DEADZONE_EXIT_SPAN,
  );
  if (!active || magnitude === 0) {
    return { ...IDLE_ANALOG_DRIVE, magnitudeSpan: magnitude };
  }
  const normalized = clamp(
    (magnitude - DEADZONE_EXIT_SPAN) / (FULL_DEFLECTION_SPAN - DEADZONE_EXIT_SPAN),
    0,
    1,
  );
  const deflection = expoCurve(normalized, DRIVE_EXPO);
  const scale = (deflection * 1000) / magnitude;
  // "|| 0" normalizes the -0 that Math.round produces for tiny negatives.
  return {
    active: true,
    throttle: Math.round(-dySpan * scale) || 0,
    steering: Math.round(-dxSpan * scale) || 0,
    magnitudeSpan: magnitude,
    deflection,
  };
}

// ---------------------------------------------------------------------------
// Sector labeling (display only — the drive command itself is analog)
// ---------------------------------------------------------------------------

const SECTOR_CENTER_DEG: Record<Exclude<DirectionCode, "S">, number> = {
  R: 0,
  BR: 45,
  B: 90,
  BL: 135,
  L: 180,
  FL: -135,
  F: -90,
  FR: -45,
};

function angularDistanceDeg(a: number, b: number): number {
  let difference = (a - b) % 360;
  if (difference > 180) difference -= 360;
  if (difference < -180) difference += 360;
  return Math.abs(difference);
}

export function sectorFromVector(dx: number, dy: number): DirectionCode {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best: DirectionCode = "R";
  let bestDistance = Infinity;
  for (const [code, center] of Object.entries(SECTOR_CENTER_DEG)) {
    const candidate = angularDistanceDeg(angle, center);
    if (candidate < bestDistance) {
      bestDistance = candidate;
      best = code as DirectionCode;
    }
  }
  return best;
}

/**
 * Sector with angular hysteresis: stay in the previous sector until the
 * vector leaves it by SECTOR_HYSTERESIS_DEG.
 */
export function stickySector(
  dx: number,
  dy: number,
  previous: DirectionCode | null,
): DirectionCode {
  const fresh = sectorFromVector(dx, dy);
  if (previous === null || previous === "S" || previous === fresh) return fresh;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const previousCenter = SECTOR_CENTER_DEG[previous as Exclude<DirectionCode, "S">];
  if (angularDistanceDeg(angle, previousCenter) <= 22.5 + SECTOR_HYSTERESIS_DEG) {
    return previous;
  }
  return fresh;
}

export function directionName(code: DirectionCode): string {
  return COMMANDS[code].label;
}

// ---------------------------------------------------------------------------
// Speed hand: pinch pose classification (the drag itself lives in the hook)
// ---------------------------------------------------------------------------

export interface SpeedPose {
  state: RecognizedSpeedPose;
  fingers: boolean[];
  pinchRatio: number;
  /** Normalized image y of the thumb-index midpoint (0 top, 1 bottom). */
  pinchY: number;
}

export function normalizedPinchDistance(
  landmarks: Landmark[],
  aspect: number,
): number {
  return (
    distance2D(lm(landmarks, TIP.thumb), lm(landmarks, TIP.index), aspect) /
    palmScalePlanar(landmarks, aspect)
  );
}

/**
 * The speed hand acts like a draggable slider: thumb-index pinch grabs it,
 * vertical motion adjusts, release locks the value. Two of the three
 * supporting fingers must stay open so a fist or an accidental finger
 * crossing is never mistaken for a speed command.
 */
export function recognizeSpeedPose(
  landmarks: Landmark[],
  previousFingers: boolean[] | null,
  wasPinching: boolean,
  aspect: number,
): SpeedPose {
  const fingers = fingersUp(landmarks, previousFingers);
  const supportingFingerCount = fingers.slice(2).filter(Boolean).length;
  const pinchRatio = normalizedPinchDistance(landmarks, aspect);
  const pinchThreshold = wasPinching ? PINCH_EXIT_RATIO : PINCH_ENTER_RATIO;
  const pinchY = (lm(landmarks, TIP.thumb).y + lm(landmarks, TIP.index).y) / 2;

  if (supportingFingerCount >= 2 && pinchRatio <= pinchThreshold) {
    return { state: "adjusting", fingers, pinchRatio, pinchY };
  }
  if (supportingFingerCount >= 2) {
    return { state: "locked", fingers, pinchRatio, pinchY };
  }
  return { state: "invalid", fingers, pinchRatio, pinchY };
}

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
