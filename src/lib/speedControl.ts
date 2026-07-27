import { clamp } from "./filters";
import {
  SPEED_DRAG_GAIN_PER_SPAN,
  type RecognizedSpeedPose,
  type SpeedGestureState,
} from "./gestureRecognition";

export const SPEED_MIN = 0;
export const SPEED_MAX = 1000;
/** Ignore drags smaller than this so a resting pinch does not creep. */
export const SPEED_DEADBAND = 4;

export interface SpeedSliderResult {
  /** Current speed limit, 0..1000, sent as the DRIVE packet's speedLimit. */
  value: number;
  gesture: SpeedGestureState;
  /** True whenever the value is being held rather than actively dragged. */
  locked: boolean;
}

/**
 * The speed hand's slider, as a value that persists independently of whether
 * the hand is currently visible.
 *
 * The hand sets a ceiling and then stops mattering: taking it out of frame
 * holds the last value instead of stopping the vehicle, so the operator can
 * drive one-handed. The control hand remains the dead-man — losing *it* is
 * what stops the vehicle.
 *
 * Deliberately a plain object with no timing or filtering: the caller owns the
 * One-Euro filter on the pinch midpoint and passes the filtered value in.
 */
export class SpeedSlider {
  private value = SPEED_MIN;
  private pinching = false;
  private grabY = 0;
  private grabValue = SPEED_MIN;

  reset(value: number = SPEED_MIN): void {
    this.value = clamp(Math.round(value), SPEED_MIN, SPEED_MAX);
    this.pinching = false;
    this.grabY = 0;
    this.grabValue = this.value;
  }

  current(): number {
    return this.value;
  }

  isPinching(): boolean {
    return this.pinching;
  }

  /**
   * The speed hand is out of frame or not trusted enough to read. The value is
   * held and any in-progress grab is released, so the hand coming back starts
   * a fresh drag rather than resuming against a stale grab point.
   */
  hold(): SpeedSliderResult {
    this.pinching = false;
    return { value: this.value, gesture: "absent", locked: true };
  }

  /**
   * Applies a recognized pose. An invalid pose holds the value exactly like an
   * absent hand: a half-formed hand is strictly less informative than no hand
   * at all, so it must not be the more dangerous of the two.
   */
  apply(
    poseState: RecognizedSpeedPose,
    filteredPinchY: number,
    handScale: number,
  ): SpeedSliderResult {
    if (poseState !== "adjusting") {
      this.pinching = false;
      return { value: this.value, gesture: poseState, locked: true };
    }

    if (!this.pinching) {
      // Fresh grab: the slider moves relative to where it was grabbed, so the
      // value never teleports to the hand's absolute height.
      this.pinching = true;
      this.grabY = filteredPinchY;
      this.grabValue = this.value;
    }
    const deltaSpan = (this.grabY - filteredPinchY) / Math.max(handScale, 0.001);
    const next = clamp(
      Math.round(this.grabValue + deltaSpan * SPEED_DRAG_GAIN_PER_SPAN),
      SPEED_MIN,
      SPEED_MAX,
    );
    if (Math.abs(next - this.value) >= SPEED_DEADBAND) this.value = next;
    return { value: this.value, gesture: "adjusting", locked: false };
  }
}
