import { clamp, ema, normalizeRange, OneEuroPointFilter } from "./filters";
import {
  MIN_HANDEDNESS_SCORE,
  MIN_PALM_SCALE,
  palmCenter,
  palmScalePlanar,
  toPlanar,
  type Handedness,
  type Landmark,
  type Point,
  type ScreenSide,
} from "./gestureRecognition";

// ---------------------------------------------------------------------------
// Multi-frame hand identity.
//
// MediaPipe returns an unordered list of hands per frame with no stable
// identity: the array order can swap between frames, and the handedness label
// flips on an ambiguous view. Binding the driving roles to "whichever hand is
// currently on the left half" therefore breaks the moment the operator drifts
// across the midline or the labels swap for one frame.
//
// This tracker assigns a persistent id to each hand by associating detections
// with the previous frame's tracks, so a role stays attached to a physical
// hand. It also owns the smoothing, the velocity estimate used for latency
// compensation, and a quality score that lets the caller refuse to drive on a
// half-observed hand.
// ---------------------------------------------------------------------------

/**
 * Association gate. A detection further than this from a track's predicted
 * position (in palm-span units) is treated as a different hand.
 *
 * It is deliberately generous: matching is greedy cheapest-pair-first and
 * carries a handedness penalty, which is what actually keeps two hands apart,
 * while the velocity guard below is what keeps a bad match harmless. A tight
 * gate would instead throw the identity away on every large jump and force the
 * operator to redo the role setup.
 */
export const MAX_ASSOCIATION_SPAN = 3;

/**
 * Denominator for the residual term of the quality score. Smaller than the
 * association gate: a match may be accepted and still be poor enough that the
 * vehicle should not be driven from it.
 */
const QUALITY_RESIDUAL_SPAN = 1.2;

/** Soft penalty when MediaPipe's handedness label disagrees with the track. */
const HANDEDNESS_MISMATCH_COST_SPAN = 0.7;

/**
 * Fastest plausible palm motion, in palm spans per second. A hand sweeping
 * across the frame in 0.2 s moves at roughly 8 spans/s; a mis-detection that
 * latches onto a face or a second person teleports at 40+ spans/s, so this
 * threshold separates the two cleanly.
 */
export const MAX_PALM_SPEED_SPANS_PER_SEC = 14;

/**
 * Consecutive velocity-limited frames before a track concludes the detection
 * is right and it is the track that is stale.
 */
export const JUMP_FRAMES_BEFORE_REACQUIRE = 3;

/** A track survives this long without a detection before it is dropped. */
export const MAX_COAST_MS = 120;

/** Frames a new or re-acquired track needs before it is fully trusted. */
export const QUALITY_RAMP_FRAMES = 5;

/** Minimum track quality allowed to produce a movement command. */
export const MIN_DRIVE_QUALITY = 0.5;

/** Screen-side hysteresis, so a hand resting on the midline stops flickering. */
const SIDE_HYSTERESIS = 0.03;

/** Upper bound on how far ahead latency compensation may extrapolate. */
export const MAX_PREDICTION_MS = 45;

/** Hard cap on the predicted displacement, in palm spans. */
export const MAX_PREDICTION_SPAN = 0.15;

export interface HandObservation {
  landmarks: Landmark[];
  handedness: Handedness;
  handednessScore: number;
  /** Palm center in mirrored normalized space. */
  center: Point;
  /** Palm center in planar space (x multiplied by the aspect ratio). */
  planarCenter: Point;
  /** Palm scale in planar units. */
  scale: number;
}

export interface HandTrack {
  /** Stable across frames for as long as the hand keeps being detected. */
  id: number;
  handedness: Handedness;
  handednessScore: number;
  /** Landmarks of the most recent detection (held while coasting). */
  landmarks: Landmark[];
  /** Jump-guarded planar palm center, before smoothing. */
  planarCenter: Point;
  /** One-Euro smoothed planar palm center — the joystick input. */
  smoothedCenter: Point;
  /** Smoothed planar velocity in units per second. */
  velocity: Point;
  /** EMA of the palm scale in planar units. */
  scale: number;
  side: ScreenSide;
  /** 0..1 confidence that this is a real, well-observed hand right now. */
  quality: number;
  /** Frames since the track was created or re-acquired. */
  age: number;
  /** True on a frame with no matching detection (position is held). */
  coasting: boolean;
  /** True while the track is rebuilding confidence after a rejected jump. */
  reacquiring: boolean;
  /** True on a frame whose detection was rejected as an implausible jump. */
  jumpRejected: boolean;
}

interface TrackState {
  id: number;
  handedness: Handedness;
  handednessScore: number;
  landmarks: Landmark[];
  planarCenter: Point;
  smoothedCenter: Point;
  velocity: Point;
  scale: number;
  side: ScreenSide;
  age: number;
  missedMs: number;
  coasting: boolean;
  jumpFrames: number;
  jumpRejected: boolean;
  reacquiring: boolean;
  residualSpan: number;
  filter: OneEuroPointFilter;
}

/** Builds the per-frame observation the tracker consumes. */
export function observeHand(
  landmarks: Landmark[],
  handedness: Handedness,
  handednessScore: number,
  aspect: number,
): HandObservation {
  const center = palmCenter(landmarks);
  return {
    landmarks,
    handedness,
    handednessScore,
    center,
    planarCenter: toPlanar(center, aspect),
    scale: palmScalePlanar(landmarks, aspect),
  };
}

function resolveSide(
  planarX: number,
  aspect: number,
  previous: ScreenSide | null,
): ScreenSide {
  const normalizedX = planarX / aspect;
  if (previous === null) return normalizedX < 0.5 ? "left" : "right";
  if (previous === "left") {
    return normalizedX > 0.5 + SIDE_HYSTERESIS ? "right" : "left";
  }
  return normalizedX < 0.5 - SIDE_HYSTERESIS ? "left" : "right";
}

/**
 * Multiplicative quality: every factor is a reason to distrust the track, and
 * any one of them collapsing to zero must be enough to stop the vehicle.
 */
function computeQuality(track: TrackState): number {
  // Handedness below MIN_HANDEDNESS_SCORE means the model itself cannot tell
  // which hand it is looking at, which usually accompanies a bad pose.
  const handedness = normalizeRange(track.handednessScore, MIN_HANDEDNESS_SCORE, 0.95);
  const age = clamp(track.age / QUALITY_RAMP_FRAMES, 0, 1);
  const coast = clamp(1 - track.missedMs / MAX_COAST_MS, 0, 1);
  const scale = clamp(track.scale / (MIN_PALM_SCALE * 2), 0, 1);
  const residual = clamp(1 - track.residualSpan / QUALITY_RESIDUAL_SPAN, 0, 1);
  // A frame whose detection was velocity-limited is by definition suspect.
  const jump = track.jumpFrames > 0 ? 0.25 : 1;
  return clamp(handedness * age * coast * scale * residual * jump, 0, 1);
}

/**
 * Time the hand has had to move since the track last saw it. For an observed
 * track this is one frame; for one resuming after a coast it also covers the
 * gap, because the track froze its position for the whole of it.
 */
function elapsedSeconds(track: TrackState, dt: number): number {
  return dt + track.missedMs / 1000;
}

function snapshot(track: TrackState): HandTrack {
  return {
    id: track.id,
    handedness: track.handedness,
    handednessScore: track.handednessScore,
    landmarks: track.landmarks,
    planarCenter: { ...track.planarCenter },
    smoothedCenter: { ...track.smoothedCenter },
    velocity: { ...track.velocity },
    scale: track.scale,
    side: track.side,
    quality: computeQuality(track),
    age: track.age,
    coasting: track.coasting,
    reacquiring: track.reacquiring,
    jumpRejected: track.jumpRejected,
  };
}

/**
 * Latency compensation: extrapolate the smoothed palm center along its own
 * velocity by the measured capture-to-command latency, so the joystick center
 * matches where the hand is now rather than where it was one pipeline ago.
 *
 * Both the horizon and the resulting displacement are hard-capped, so an
 * over-estimated velocity can add at most MAX_PREDICTION_SPAN of deflection —
 * a fraction of the dead-zone-to-full-scale travel, never a phantom command.
 */
export function predictCenter(track: HandTrack, latencyMs: number): Point {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    return { ...track.smoothedCenter };
  }
  const horizonSeconds = Math.min(latencyMs, MAX_PREDICTION_MS) / 1000;
  let dx = track.velocity.x * horizonSeconds;
  let dy = track.velocity.y * horizonSeconds;
  const limit = MAX_PREDICTION_SPAN * track.scale;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > limit && magnitude > 0) {
    const scale = limit / magnitude;
    dx *= scale;
    dy *= scale;
  }
  return {
    x: track.smoothedCenter.x + dx,
    y: track.smoothedCenter.y + dy,
  };
}

export class HandTracker {
  private readonly aspect: number;
  private tracks: TrackState[] = [];
  private nextId = 1;
  private lastUpdateMs: number | null = null;

  constructor(aspect: number) {
    this.aspect = aspect;
  }

  reset(): void {
    this.tracks = [];
    this.lastUpdateMs = null;
  }

  /**
   * Associates this frame's detections with the existing tracks and returns
   * the updated set, ordered by id so the caller sees a stable sequence.
   */
  update(observations: HandObservation[], nowMs: number): HandTrack[] {
    const deltaMs =
      this.lastUpdateMs === null ? 0 : Math.max(0, nowMs - this.lastUpdateMs);
    this.lastUpdateMs = nowMs;
    // Clamped so a stalled pipeline cannot open the jump gate arbitrarily wide
    // and a duplicate timestamp cannot divide by zero.
    const dt = clamp(deltaMs / 1000, 1 / 240, 0.25);

    const matchedTracks = new Set<number>();
    const matchedObservations = new Set<number>();
    for (const { track, index } of this.rankPairs(observations, dt)) {
      const observation = observations[index];
      if (
        !observation ||
        matchedTracks.has(track.id) ||
        matchedObservations.has(index)
      ) {
        continue;
      }
      matchedTracks.add(track.id);
      matchedObservations.add(index);
      this.applyObservation(track, observation, dt, nowMs);
    }

    for (const track of this.tracks) {
      if (matchedTracks.has(track.id)) continue;
      // Coast: hold the last position, let the quality decay, and drop the
      // track once the gap is long enough that identity is no longer credible.
      // Age does not advance here — an unobserved frame is not evidence.
      track.coasting = true;
      track.jumpRejected = false;
      track.missedMs += deltaMs;
    }
    this.tracks = this.tracks.filter((track) => track.missedMs <= MAX_COAST_MS);

    observations.forEach((observation, index) => {
      if (matchedObservations.has(index)) return;
      this.tracks.push(this.createTrack(observation, nowMs));
    });

    this.tracks.sort((a, b) => a.id - b.id);
    return this.tracks.map(snapshot);
  }

  /** Every gated (track, observation) pair, cheapest association first. */
  private rankPairs(
    observations: HandObservation[],
    dt: number,
  ): { cost: number; track: TrackState; index: number }[] {
    const pairs: { cost: number; track: TrackState; index: number }[] = [];
    for (const track of this.tracks) {
      const reference = Math.max(track.scale, MIN_PALM_SCALE);
      // A coasting track froze its position, so the hand has had the whole gap
      // to move, not just this frame.
      const elapsed = elapsedSeconds(track, dt);
      // Predict with the track's own velocity so a fast but steady hand is not
      // penalized relative to a stationary one.
      const predictedX = track.planarCenter.x + track.velocity.x * elapsed;
      const predictedY = track.planarCenter.y + track.velocity.y * elapsed;
      observations.forEach((observation, index) => {
        const distance = Math.hypot(
          predictedX - observation.planarCenter.x,
          predictedY - observation.planarCenter.y,
        );
        let cost = distance / reference;
        if (observation.handedness !== track.handedness) {
          cost += HANDEDNESS_MISMATCH_COST_SPAN;
        }
        if (cost > MAX_ASSOCIATION_SPAN) return;
        pairs.push({ cost, track, index });
      });
    }
    return pairs.sort((a, b) => a.cost - b.cost);
  }

  private createTrack(observation: HandObservation, nowMs: number): TrackState {
    const filter = new OneEuroPointFilter({ minCutoffHz: 1.2, beta: 0.025 });
    const smoothed = filter.filter(observation.planarCenter, nowMs);
    return {
      id: this.nextId++,
      handedness: observation.handedness,
      handednessScore: observation.handednessScore,
      landmarks: observation.landmarks,
      planarCenter: { ...observation.planarCenter },
      smoothedCenter: smoothed,
      velocity: { x: 0, y: 0 },
      scale: observation.scale,
      side: resolveSide(observation.planarCenter.x, this.aspect, null),
      age: 0,
      missedMs: 0,
      coasting: false,
      jumpFrames: 0,
      jumpRejected: false,
      reacquiring: false,
      residualSpan: 0,
      filter,
    };
  }

  private applyObservation(
    track: TrackState,
    observation: HandObservation,
    dt: number,
    nowMs: number,
  ): void {
    const reference = Math.max(track.scale, MIN_PALM_SCALE);
    track.residualSpan =
      Math.hypot(
        observation.planarCenter.x - track.planarCenter.x,
        observation.planarCenter.y - track.planarCenter.y,
      ) / reference;

    const stepX = observation.planarCenter.x - track.planarCenter.x;
    const stepY = observation.planarCenter.y - track.planarCenter.y;
    const step = Math.hypot(stepX, stepY);
    const maxStep =
      MAX_PALM_SPEED_SPANS_PER_SEC * reference * elapsedSeconds(track, dt);

    let next = { ...observation.planarCenter };
    track.jumpRejected = false;
    if (step > maxStep && maxStep > 0) {
      track.jumpFrames += 1;
      track.jumpRejected = true;
      if (track.jumpFrames >= JUMP_FRAMES_BEFORE_REACQUIRE) {
        // The detection has insisted for several frames: the hand really did
        // move (or was re-found elsewhere). Snap to it, drop the smoothing
        // history, and make the track earn its quality back from zero so the
        // caller stops the vehicle during the re-acquisition.
        track.jumpFrames = 0;
        track.jumpRejected = false;
        track.age = 0;
        track.reacquiring = true;
        track.filter.reset();
      } else {
        const limit = maxStep / step;
        next = {
          x: track.planarCenter.x + stepX * limit,
          y: track.planarCenter.y + stepY * limit,
        };
      }
    } else {
      track.jumpFrames = 0;
      track.age += 1;
    }

    if (track.reacquiring && track.age >= QUALITY_RAMP_FRAMES) {
      track.reacquiring = false;
    }

    track.planarCenter = next;
    track.smoothedCenter = track.filter.filter(next, nowMs);
    track.velocity = track.filter.velocity();
    track.landmarks = observation.landmarks;
    track.handedness = observation.handedness;
    track.handednessScore = observation.handednessScore;
    track.scale = ema(track.scale, observation.scale, 0.2);
    track.side = resolveSide(track.smoothedCenter.x, this.aspect, track.side);
    track.missedMs = 0;
    track.coasting = false;
  }
}
