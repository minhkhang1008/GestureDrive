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

export interface Point {
  x: number;
  y: number;
}

const WRIST = 0;
const MCP = { index: 5, middle: 9, ring: 13, pinky: 17 };
const TIP = { middle: 12 };

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
// Where the joystick centre is allowed to sit
// ---------------------------------------------------------------------------

/**
 * Required clearance from every frame edge, in palm spans. At 0.8 spans the
 * operator can still reach roughly 70% deflection toward the nearest edge,
 * which the expo curve already makes a fast command.
 */
export const ANCHOR_EDGE_MARGIN_SPAN = 0.8;

export type AnchorPlacement = "ok" | "near-edge" | "hand-too-large";

/**
 * Whether a palm position is a legitimate joystick centre.
 *
 * Planting the origin wherever the hand first appears puts it against the
 * frame edge when the hand enters from the side, and there is then no room to
 * drag that way at all. Both inputs are in planar space (x already multiplied
 * by the aspect ratio), so the frame spans x in [0, aspect] and y in [0, 1].
 *
 * "hand-too-large" means the required margin cannot fit in the frame at any
 * position, i.e. the hand is so close to the camera that the operator has to
 * move back rather than move sideways.
 */
export function classifyAnchorPlacement(
  palm: Point,
  scale: number,
  aspect: number,
): AnchorPlacement {
  const margin = ANCHOR_EDGE_MARGIN_SPAN * scale;
  if (margin * 2 >= 1 || margin * 2 >= aspect) return "hand-too-large";
  const inside =
    palm.x >= margin &&
    palm.x <= aspect - margin &&
    palm.y >= margin &&
    palm.y <= 1 - margin;
  return inside ? "ok" : "near-edge";
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

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
