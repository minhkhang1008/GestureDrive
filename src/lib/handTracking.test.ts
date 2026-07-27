import { describe, expect, it } from "vitest";
import type { Handedness, Landmark } from "./gestureRecognition";
import {
  HandTracker,
  JUMP_FRAMES_BEFORE_REACQUIRE,
  MAX_COAST_MS,
  MAX_PALM_SPEED_SPANS_PER_SEC,
  MAX_PREDICTION_SPAN,
  MIN_DRIVE_QUALITY,
  observeHand,
  predictCenter,
  QUALITY_RAMP_FRAMES,
  type HandObservation,
} from "./handTracking";

const ASPECT = 1;
const FRAME_MS = 1000 / 30;

/**
 * Synthetic hand centred on (x, y) with a fixed palm geometry. Only the wrist
 * and the four MCPs matter to the tracker (palm center and palm scale).
 */
function hand(x: number, y: number, scale = 0.26): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  landmarks[0] = { x, y: y + scale * 0.6, z: 0 };
  landmarks[5] = { x: x - scale * 0.4, y: y - scale * 0.2, z: 0 };
  landmarks[9] = { x, y: y - scale * 0.25, z: 0 };
  landmarks[13] = { x: x + scale * 0.25, y: y - scale * 0.2, z: 0 };
  landmarks[17] = { x: x + scale * 0.4, y: y - scale * 0.1, z: 0 };
  return landmarks;
}

function observe(
  x: number,
  y: number,
  handedness: Handedness = "Right",
  score = 0.98,
): HandObservation {
  return observeHand(hand(x, y), handedness, score, ASPECT);
}

/** Runs the tracker for `frames` steps, returning the final track list. */
function settle(
  tracker: HandTracker,
  build: (frame: number) => HandObservation[],
  frames: number,
  startMs = 0,
) {
  let tracks = tracker.update(build(0), startMs);
  for (let frame = 1; frame < frames; frame += 1) {
    tracks = tracker.update(build(frame), startMs + frame * FRAME_MS);
  }
  return tracks;
}

describe("hand identity", () => {
  it("keeps the same id while a hand moves", () => {
    const tracker = new HandTracker(ASPECT);
    const first = tracker.update([observe(0.3, 0.5)], 0);
    const id = first[0]?.id;
    expect(id).toBeDefined();

    let tracks = first;
    for (let frame = 1; frame <= 20; frame += 1) {
      tracks = tracker.update([observe(0.3 + frame * 0.01, 0.5)], frame * FRAME_MS);
    }
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.id).toBe(id);
  });

  it("keeps roles attached when two hands cross the screen midline", () => {
    const tracker = new HandTracker(ASPECT);
    // Left hand walks right, right hand walks left; they swap halves.
    const tracks = settle(
      tracker,
      (frame) => [
        observe(0.25 + frame * 0.02, 0.5, "Left"),
        observe(0.75 - frame * 0.02, 0.5, "Right"),
      ],
      26,
    );

    expect(tracks).toHaveLength(2);
    const leftHand = tracks.find((track) => track.handedness === "Left");
    const rightHand = tracks.find((track) => track.handedness === "Right");
    // Ids 1 and 2 were assigned on the first frame and must have survived the
    // crossing: this is what lets a role stay bound to a physical hand.
    expect(leftHand?.id).toBe(1);
    expect(rightHand?.id).toBe(2);
    // They really did swap halves.
    expect(leftHand?.side).toBe("right");
    expect(rightHand?.side).toBe("left");
  });

  it("does not flicker the reported side for a hand resting on the midline", () => {
    const tracker = new HandTracker(ASPECT);
    const tracks = settle(
      tracker,
      (frame) => [observe(0.5 + (frame % 2 === 0 ? 0.01 : -0.01), 0.5)],
      12,
    );
    expect(tracks[0]?.side).toBe("right");
  });

  it("assigns a new id to a genuinely new hand", () => {
    const tracker = new HandTracker(ASPECT);
    tracker.update([observe(0.3, 0.5)], 0);
    const tracks = tracker.update([observe(0.31, 0.5), observe(0.8, 0.5)], FRAME_MS);
    expect(tracks).toHaveLength(2);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(2);
  });
});

describe("jump rejection", () => {
  it("clamps a one-frame teleport instead of following it", () => {
    const tracker = new HandTracker(ASPECT);
    const settled = settle(tracker, () => [observe(0.3, 0.5)], 10);
    const origin = settled[0]?.planarCenter ?? { x: 0, y: 0 };

    // A mis-detection latching onto a face or a bystander's hand.
    const tracks = tracker.update([observe(0.65, 0.35)], 10 * FRAME_MS);
    const track = tracks[0];
    expect(track?.id).toBe(1);
    expect(track?.jumpRejected).toBe(true);
    // Movement is capped at the plausible-speed limit, not the teleport.
    const maxStep = MAX_PALM_SPEED_SPANS_PER_SEC * (track?.scale ?? 0) * (FRAME_MS / 1000);
    const moved = Math.hypot(
      (track?.planarCenter.x ?? 0) - origin.x,
      (track?.planarCenter.y ?? 0) - origin.y,
    );
    expect(moved).toBeLessThanOrEqual(maxStep + 1e-9);
    // And the vehicle must not be driven from a suspect frame.
    expect(track?.quality ?? 1).toBeLessThan(MIN_DRIVE_QUALITY);
  });

  it("re-acquires when the detection insists, with quality held at zero", () => {
    const tracker = new HandTracker(ASPECT);
    settle(tracker, () => [observe(0.3, 0.5)], 10);

    let tracks = tracker.update([observe(0.65, 0.35)], 10 * FRAME_MS);
    for (let frame = 1; frame < JUMP_FRAMES_BEFORE_REACQUIRE; frame += 1) {
      tracks = tracker.update([observe(0.65, 0.35)], (10 + frame) * FRAME_MS);
    }

    const track = tracks[0];
    expect(track?.id).toBe(1);
    expect(track?.reacquiring).toBe(true);
    expect(track?.quality).toBe(0);
    // The snap landed on the detection rather than crawling toward it.
    const expected = observe(0.65, 0.35).planarCenter;
    expect(track?.planarCenter.x).toBeCloseTo(expected.x, 6);
    expect(track?.planarCenter.y).toBeCloseTo(expected.y, 6);

    // Quality recovers once the new position has been confirmed for a while.
    tracks = settle(
      tracker,
      () => [observe(0.65, 0.35)],
      QUALITY_RAMP_FRAMES + 4,
      (10 + JUMP_FRAMES_BEFORE_REACQUIRE) * FRAME_MS,
    );
    expect(tracks[0]?.reacquiring).toBe(false);
    expect(tracks[0]?.quality ?? 0).toBeGreaterThan(MIN_DRIVE_QUALITY);
  });

  it("drops identity rather than hijacking a role on a frame-wide teleport", () => {
    const tracker = new HandTracker(ASPECT);
    settle(tracker, () => [observe(0.3, 0.5)], 10);

    // Beyond the association gate entirely: this cannot be the same hand, so
    // the established track coasts (its role stops the vehicle) and the
    // detection becomes a separate, untrusted track.
    const tracks = tracker.update([observe(0.95, 0.1)], 10 * FRAME_MS);
    expect(tracks).toHaveLength(2);
    const original = tracks.find((track) => track.id === 1);
    expect(original?.coasting).toBe(true);
    const spawned = tracks.find((track) => track.id !== 1);
    expect(spawned?.quality).toBe(0);
  });

  it("follows fast but plausible hand motion without rejecting it", () => {
    const tracker = new HandTracker(ASPECT);
    // 6 spans/second: a brisk sweep, well inside the plausibility limit.
    const perFrame = 6 * 0.26 * (FRAME_MS / 1000);
    const tracks = settle(
      tracker,
      (frame) => [observe(0.2 + frame * perFrame, 0.5)],
      12,
    );
    expect(tracks[0]?.jumpRejected).toBe(false);
    expect(tracks[0]?.quality ?? 0).toBeGreaterThan(MIN_DRIVE_QUALITY);
  });
});

describe("coasting and quality", () => {
  it("survives a single dropped detection and keeps its id", () => {
    const tracker = new HandTracker(ASPECT);
    settle(tracker, () => [observe(0.3, 0.5)], 10);

    const coasted = tracker.update([], 10 * FRAME_MS);
    expect(coasted).toHaveLength(1);
    expect(coasted[0]?.coasting).toBe(true);
    expect(coasted[0]?.id).toBe(1);

    const resumed = tracker.update([observe(0.3, 0.5)], 11 * FRAME_MS);
    expect(resumed[0]?.id).toBe(1);
    expect(resumed[0]?.coasting).toBe(false);
  });

  it("lets a hand that moved during a dropout resume without a false jump", () => {
    const tracker = new HandTracker(ASPECT);
    settle(tracker, () => [observe(0.3, 0.5)], 10);

    // Three dropped frames while the hand keeps moving at a normal speed. The
    // track froze its position, so on resume the observation is three frames
    // of travel away — that is the hand moving, not a mis-detection.
    const perFrame = 5 * 0.26 * (FRAME_MS / 1000);
    tracker.update([], 10 * FRAME_MS);
    tracker.update([], 11 * FRAME_MS);
    tracker.update([], 12 * FRAME_MS);
    const resumed = tracker.update(
      [observe(0.3 + 4 * perFrame, 0.5)],
      13 * FRAME_MS,
    );

    expect(resumed[0]?.id).toBe(1);
    expect(resumed[0]?.jumpRejected).toBe(false);
    expect(resumed[0]?.reacquiring).toBe(false);
  });

  it("drops a track once the gap exceeds the coast window", () => {
    const tracker = new HandTracker(ASPECT);
    settle(tracker, () => [observe(0.3, 0.5)], 10);
    const tracks = tracker.update([], 10 * FRAME_MS + MAX_COAST_MS + 1);
    expect(tracks).toHaveLength(0);
  });

  it("refuses to trust a brand-new track until it has been confirmed", () => {
    const tracker = new HandTracker(ASPECT);
    const first = tracker.update([observe(0.3, 0.5)], 0);
    expect(first[0]?.quality).toBe(0);

    const settled = settle(tracker, () => [observe(0.3, 0.5)], QUALITY_RAMP_FRAMES + 2);
    expect(settled[0]?.quality ?? 0).toBeGreaterThan(MIN_DRIVE_QUALITY);
  });

  it("collapses quality when the model cannot tell which hand it sees", () => {
    const tracker = new HandTracker(ASPECT);
    settle(tracker, () => [observe(0.3, 0.5)], 10);
    const tracks = tracker.update(
      [observe(0.3, 0.5, "Right", 0.55)],
      10 * FRAME_MS,
    );
    expect(tracks[0]?.quality).toBe(0);
  });

  it("collapses quality for a hand too small to measure reliably", () => {
    const tracker = new HandTracker(ASPECT);
    const tiny = () => [observeHand(hand(0.3, 0.5, 0.02), "Right", 0.98, ASPECT)];
    const tracks = settle(tracker, tiny, QUALITY_RAMP_FRAMES + 4);
    expect(tracks[0]?.quality ?? 1).toBeLessThan(MIN_DRIVE_QUALITY);
  });
});

describe("latency compensation", () => {
  it("extrapolates along the measured velocity", () => {
    const tracker = new HandTracker(ASPECT);
    const perFrame = 0.01;
    const tracks = settle(
      tracker,
      (frame) => [observe(0.3 + frame * perFrame, 0.5)],
      20,
    );
    const track = tracks[0];
    expect(track).toBeDefined();
    if (!track) return;

    expect(track.velocity.x).toBeGreaterThan(0);
    const predicted = predictCenter(track, 40);
    expect(predicted.x).toBeGreaterThan(track.smoothedCenter.x);
    expect(predicted.y).toBeCloseTo(track.smoothedCenter.y, 6);
  });

  it("never extrapolates further than the span cap", () => {
    const tracker = new HandTracker(ASPECT);
    const perFrame = 10 * 0.26 * (FRAME_MS / 1000);
    const tracks = settle(
      tracker,
      (frame) => [observe(0.05 + frame * perFrame, 0.5)],
      14,
    );
    const track = tracks[0];
    expect(track).toBeDefined();
    if (!track) return;

    // Ask for an absurd horizon: the cap, not the request, decides.
    const predicted = predictCenter(track, 10_000);
    const displacement = Math.hypot(
      predicted.x - track.smoothedCenter.x,
      predicted.y - track.smoothedCenter.y,
    );
    expect(displacement).toBeLessThanOrEqual(MAX_PREDICTION_SPAN * track.scale + 1e-9);
  });

  it("is a no-op for a still hand or a non-positive horizon", () => {
    const tracker = new HandTracker(ASPECT);
    const tracks = settle(tracker, () => [observe(0.3, 0.5)], 20);
    const track = tracks[0];
    expect(track).toBeDefined();
    if (!track) return;

    expect(predictCenter(track, 0)).toEqual(track.smoothedCenter);
    expect(predictCenter(track, Number.NaN)).toEqual(track.smoothedCenter);
    const predicted = predictCenter(track, 40);
    expect(predicted.x).toBeCloseTo(track.smoothedCenter.x, 6);
    expect(predicted.y).toBeCloseTo(track.smoothedCenter.y, 6);
  });
});
