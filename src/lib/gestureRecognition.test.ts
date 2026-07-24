import { describe, expect, it } from "vitest";
import {
  PINCH_ENTER_RATIO,
  PINCH_EXIT_RATIO,
  normalizedPinchDistance,
  recognizeSpeedGesture,
  speedFromY,
  type Landmark,
} from "./gestureRecognition";

function point(x = 0.5, y = 0.5, z = 0): Landmark {
  return { x, y, z };
}

function speedHand(pinchRatio: number): Landmark[] {
  const landmarks = Array.from({ length: 21 }, () => point());

  landmarks[0] = point(0.5, 0.9); // wrist
  landmarks[5] = point(0.35, 0.65); // index MCP
  landmarks[9] = point(0.5, 0.65); // middle MCP
  landmarks[13] = point(0.6, 0.67); // ring MCP
  landmarks[17] = point(0.65, 0.7); // pinky MCP

  // Keep the three supporting fingers extended, matching the OK/pinch pose.
  for (const [mcp, pip, dip, tip] of [
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ]) {
    const x = landmarks[mcp].x;
    landmarks[pip] = point(x, 0.5);
    landmarks[dip] = point(x, 0.35);
    landmarks[tip] = point(x, 0.2);
  }

  landmarks[8] = point(0.5, 0.3); // index tip
  const palmScale = Math.hypot(0.65 - 0.35, 0.7 - 0.65);
  landmarks[4] = point(0.5 - pinchRatio * palmScale, 0.3); // thumb tip
  landmarks[2] = point(0.3, 0.68);
  landmarks[3] = point(0.34, 0.48);

  return landmarks;
}

describe("speed pinch gesture", () => {
  it("maps the top and bottom of the slider to 1000 and 0", () => {
    expect(speedFromY(0.14)).toBe(1000);
    expect(speedFromY(0.86)).toBe(0);
    expect(speedFromY(-1)).toBe(1000);
    expect(speedFromY(2)).toBe(0);
  });

  it("normalizes pinch distance against the palm instead of image pixels", () => {
    const landmarks = speedHand(0.25);
    expect(normalizedPinchDistance(landmarks)).toBeCloseTo(0.25, 5);
  });

  it("uses separate pinch enter and exit thresholds to prevent flicker", () => {
    const betweenThresholds = (PINCH_ENTER_RATIO + PINCH_EXIT_RATIO) / 2;
    const landmarks = speedHand(betweenThresholds);

    expect(recognizeSpeedGesture(landmarks, "Right", false).state).toBe(
      "locked",
    );
    expect(recognizeSpeedGesture(landmarks, "Right", true).state).toBe(
      "adjusting",
    );
  });

  it("adjusts while pinched and locks after release", () => {
    const pinched = recognizeSpeedGesture(speedHand(0.2), "Right", false);
    const released = recognizeSpeedGesture(speedHand(0.8), "Right", true);

    expect(pinched.state).toBe("adjusting");
    expect(pinched.value).toBeGreaterThan(700);
    expect(released).toMatchObject({ state: "locked", value: null });
  });
});
