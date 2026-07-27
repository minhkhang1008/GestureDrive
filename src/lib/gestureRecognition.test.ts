import { describe, expect, it } from "vitest";
import { type DirectionCode } from "./commands";
import {
  analogDriveFromVector,
  DEADZONE_ENTER_SPAN,
  DEADZONE_EXIT_SPAN,
  fingersUp,
  mirrorLandmarks,
  normalizedPinchDistance,
  ORIENTATION_HYSTERESIS_SPAN,
  palmFacingSigned,
  palmScalePlanar,
  PINCH_ENTER_RATIO,
  PINCH_EXIT_RATIO,
  recognizeSetupPose,
  recognizeSpeedPose,
  resolvePalmOrientation,
  sectorFromVector,
  stickySector,
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
  ] as const) {
    const x = landmarks[mcp]?.x ?? 0.5;
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

describe("speed pinch pose", () => {
  it("normalizes pinch distance against the palm instead of image pixels", () => {
    const landmarks = speedHand(0.25);
    expect(normalizedPinchDistance(landmarks, 1)).toBeCloseTo(0.25, 5);
  });

  it("uses separate pinch enter and exit thresholds to prevent flicker", () => {
    const betweenThresholds = (PINCH_ENTER_RATIO + PINCH_EXIT_RATIO) / 2;
    const landmarks = speedHand(betweenThresholds);

    expect(recognizeSpeedPose(landmarks, null, false, 1).state).toBe("locked");
    expect(recognizeSpeedPose(landmarks, null, true, 1).state).toBe("adjusting");
  });

  it("reports the pinch midpoint for the relative drag in the hook", () => {
    const pose = recognizeSpeedPose(speedHand(0.2), null, false, 1);
    expect(pose.state).toBe("adjusting");
    expect(pose.pinchY).toBeCloseTo(0.3, 5);
  });

  it("declares the pose invalid when the supporting fingers curl", () => {
    const landmarks = speedHand(0.2);
    // Curl ring and pinky onto the palm.
    for (const [pip, dip, tip] of [
      [14, 15, 16],
      [18, 19, 20],
    ] as const) {
      landmarks[pip] = point(0.6, 0.75);
      landmarks[dip] = point(0.6, 0.85);
      landmarks[tip] = point(0.6, 0.9);
    }
    expect(recognizeSpeedPose(landmarks, null, false, 1).state).toBe("invalid");
  });
});

describe("finger hysteresis", () => {
  it("keeps a previously extended finger extended in the hysteresis band", () => {
    const landmarks = speedHand(0.2);
    const fresh = fingersUp(landmarks, null);
    const held = fingersUp(landmarks, fresh);
    expect(held).toEqual(fresh);
  });
});

describe("analog drive", () => {
  it("stays inactive inside the dead zone", () => {
    const drive = analogDriveFromVector(0, -DEADZONE_ENTER_SPAN * 0.9, false);
    expect(drive.active).toBe(false);
    expect(drive.throttle).toBe(0);
    expect(drive.steering).toBe(0);
  });

  it("activates above the enter radius and maps up to forward throttle", () => {
    const drive = analogDriveFromVector(0, -0.6, false);
    expect(drive.active).toBe(true);
    expect(drive.throttle).toBeGreaterThan(0);
    expect(drive.steering).toBe(0);
  });

  it("holds activation between exit and enter radii (hysteresis)", () => {
    const magnitude = (DEADZONE_ENTER_SPAN + DEADZONE_EXIT_SPAN) / 2;
    expect(analogDriveFromVector(0, -magnitude, false).active).toBe(false);
    expect(analogDriveFromVector(0, -magnitude, true).active).toBe(true);
  });

  it("maps right displacement to negative steering (turn right)", () => {
    const drive = analogDriveFromVector(0.6, 0, false);
    expect(drive.steering).toBeLessThan(0);
    expect(drive.throttle).toBe(0);
  });

  it("saturates at full deflection", () => {
    const drive = analogDriveFromVector(0, -5, false);
    expect(drive.throttle).toBe(1000);
    expect(drive.deflection).toBe(1);
  });

  it("is proportional: half displacement gives less than full output", () => {
    const half = analogDriveFromVector(0, -0.5, false);
    const full = analogDriveFromVector(0, -1.2, false);
    expect(half.throttle).toBeGreaterThan(0);
    expect(half.throttle).toBeLessThan(full.throttle);
  });
});

describe("sector labeling", () => {
  it("maps the eight compass directions", () => {
    expect(sectorFromVector(0, -1)).toBe("F");
    expect(sectorFromVector(0, 1)).toBe("B");
    expect(sectorFromVector(1, 0)).toBe("R");
    expect(sectorFromVector(-1, 0)).toBe("L");
    expect(sectorFromVector(1, -1)).toBe("FR");
    expect(sectorFromVector(-1, 1)).toBe("BL");
  });

  it("holds the previous sector inside the angular hysteresis band", () => {
    // 24 degrees past the F center: outside F's 22.5-degree half-width but
    // inside the widened hysteresis band.
    const angle = ((-90 + 24) * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    expect(stickySector(dx, dy, "F")).toBe("F");
    expect(stickySector(dx, dy, null)).toBe("FR");
  });
});

describe("palm orientation", () => {
  function orientedHand(indexX: number, pinkyX: number): Landmark[] {
    const landmarks = Array.from({ length: 21 }, () => point());
    landmarks[0] = point(0.5, 0.9);
    landmarks[5] = point(indexX, 0.65);
    landmarks[9] = point((indexX + pinkyX) / 2, 0.64);
    landmarks[17] = point(pinkyX, 0.66);
    return landmarks;
  }

  it("detects palm vs back in mirrored space for a right hand", () => {
    // Mirrored space: right hand palm-forward has index right of pinky.
    expect(resolvePalmOrientation(orientedHand(0.6, 0.4), "Right", null, 1)).toBe("palm");
    expect(resolvePalmOrientation(orientedHand(0.4, 0.6), "Right", null, 1)).toBe("back");
  });

  it("mirrors the convention for a left hand", () => {
    expect(resolvePalmOrientation(orientedHand(0.4, 0.6), "Left", null, 1)).toBe("palm");
    expect(resolvePalmOrientation(orientedHand(0.6, 0.4), "Left", null, 1)).toBe("back");
  });

  it("applies hysteresis before flipping", () => {
    // Barely flipped geometry: previous state must win.
    const barelyBack = orientedHand(0.495, 0.505);
    expect(resolvePalmOrientation(barelyBack, "Right", "palm", 1)).toBe("palm");
    expect(resolvePalmOrientation(barelyBack, "Right", "back", 1)).toBe("back");
  });

  /** Rotate every landmark about the frame center, in isotropic planar space. */
  function rotated(landmarks: Landmark[], degrees: number, aspect: number): Landmark[] {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return landmarks.map(({ x, y, z }) => {
      const px = (x - 0.5) * aspect;
      const py = y - 0.5;
      return {
        x: (px * cos - py * sin) / aspect + 0.5,
        y: px * sin + py * cos + 0.5,
        z,
      };
    });
  }

  it("survives in-plane rotation: the palm normal, not an x offset", () => {
    const aspect = 16 / 9;
    const palmForward = orientedHand(0.6, 0.4);
    expect(resolvePalmOrientation(palmForward, "Right", null, aspect)).toBe("palm");
    // Fingers pointing sideways and upside down still read as palm-forward.
    for (const degrees of [45, 90, 135, 180, 225, 270, 315]) {
      const turned = rotated(palmForward, degrees, aspect);
      expect(resolvePalmOrientation(turned, "Right", null, aspect)).toBe("palm");
      expect(palmFacingSigned(turned, "Right", aspect)).toBeCloseTo(
        palmFacingSigned(palmForward, "Right", aspect),
        6,
      );
    }
  });

  it("keeps the facing magnitude near zero for an edge-on hand", () => {
    // Index and pinky MCP nearly coincident: the palm is seen edge-on and the
    // signed facing collapses toward zero, which is what the hysteresis band
    // around +/-ORIENTATION_HYSTERESIS_SPAN is there to absorb.
    const edgeOn = orientedHand(0.5, 0.5);
    expect(Math.abs(palmFacingSigned(edgeOn, "Right", 1))).toBeLessThan(
      ORIENTATION_HYSTERESIS_SPAN,
    );
  });
});

describe("mirroring", () => {
  it("flips x and preserves y/z", () => {
    const [mirrored] = mirrorLandmarks([point(0.2, 0.3, 0.1)]);
    expect(mirrored).toEqual({ x: 0.8, y: 0.3, z: 0.1 });
  });
});

describe("setup pose from finger states", () => {
  it("requires all four long fingers for open, none for fist (thumb ignored)", () => {
    expect(recognizeSetupPose([true, true, true, true, true])).toBe("open");
    expect(recognizeSetupPose([false, true, true, true, true])).toBe("open");
    expect(recognizeSetupPose([false, false, false, false, false])).toBe("fist");
    expect(recognizeSetupPose([true, false, false, false, false])).toBe("fist");
  });

  it("classifies partial extension as other", () => {
    expect(recognizeSetupPose([false, true, false, false, false])).toBe("other");
    expect(recognizeSetupPose([false, true, true, true, false])).toBe("other");
    expect(recognizeSetupPose([true, false, true, false, true])).toBe("other");
  });
});

describe("palm scale", () => {
  /** Same palm (wrist + MCPs); the finger joints differ per pose. */
  function handWithFingers(curled: boolean): Landmark[] {
    const landmarks = Array.from({ length: 21 }, () => point());
    landmarks[0] = point(0.5, 0.9); // wrist
    landmarks[5] = point(0.35, 0.65); // index MCP
    landmarks[9] = point(0.5, 0.65); // middle MCP
    landmarks[13] = point(0.6, 0.67); // ring MCP
    landmarks[17] = point(0.65, 0.7); // pinky MCP
    for (const [mcp, pip, dip, tip] of [
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ] as const) {
      const x = landmarks[mcp]?.x ?? 0.5;
      if (curled) {
        landmarks[pip] = point(x, 0.72);
        landmarks[dip] = point(x, 0.8);
        landmarks[tip] = point(x, 0.85);
      } else {
        landmarks[pip] = point(x, 0.5);
        landmarks[dip] = point(x, 0.35);
        landmarks[tip] = point(x, 0.2);
      }
    }
    return landmarks;
  }

  it("is pose-invariant: an open hand and a fist share the same scale", () => {
    const aspect = 16 / 9;
    const open = palmScalePlanar(handWithFingers(false), aspect);
    const fist = palmScalePlanar(handWithFingers(true), aspect);
    expect(open).toBe(fist);
    expect(open).toBeGreaterThan(0);
  });
});

describe("analog drive shaping", () => {
  it("keeps deflection and throttle monotonic in displacement magnitude", () => {
    let lastDeflection = 0;
    let lastThrottle = 0;
    for (let magnitude = 0.15; magnitude <= 2.0; magnitude += 0.05) {
      const drive = analogDriveFromVector(0, -magnitude, true);
      expect(drive.deflection).toBeGreaterThanOrEqual(lastDeflection);
      expect(drive.throttle).toBeGreaterThanOrEqual(lastThrottle);
      lastDeflection = drive.deflection;
      lastThrottle = drive.throttle;
    }
  });

  it("produces both channels for a diagonal displacement", () => {
    // Up-right: forward throttle plus a right turn (negative steering).
    const drive = analogDriveFromVector(0.5, -0.5, false);
    expect(drive.active).toBe(true);
    expect(drive.throttle).toBeGreaterThan(0);
    expect(drive.steering).toBeLessThan(0);
  });

  it("scales the channel pair so its magnitude equals deflection * 1000", () => {
    // throttle and steering are the scaled -dy/-dx components, so their
    // hypot is deflection * 1000 up to per-channel rounding.
    for (const [dx, dy] of [
      [0.4, -0.5],
      [-0.3, 0.3],
      [0.9, 0.2],
    ] as const) {
      const drive = analogDriveFromVector(dx, dy, false);
      expect(drive.active).toBe(true);
      const magnitude = Math.hypot(drive.throttle, drive.steering);
      expect(Math.abs(magnitude - drive.deflection * 1000)).toBeLessThanOrEqual(1);
    }
  });
});

describe("sticky sector map", () => {
  const SECTOR_CENTERS: Array<[DirectionCode, number]> = [
    ["R", 0],
    ["BR", 45],
    ["B", 90],
    ["BL", 135],
    ["L", 180],
    ["FL", -135],
    ["F", -90],
    ["FR", -45],
  ];

  it("maps all eight sector centers with no previous sector", () => {
    for (const [code, degrees] of SECTOR_CENTERS) {
      const radians = (degrees * Math.PI) / 180;
      expect(stickySector(Math.cos(radians), Math.sin(radians), null)).toBe(code);
    }
  });

  it("holds inside the widened band and flips just past it", () => {
    // Sector half-width 22.5 deg + 8 deg hysteresis = 30.5 deg hold band.
    const justInside = ((-90 + 30) * Math.PI) / 180;
    expect(stickySector(Math.cos(justInside), Math.sin(justInside), "F")).toBe("F");
    // The same vector without history already reads FR: hysteresis is active.
    expect(stickySector(Math.cos(justInside), Math.sin(justInside), null)).toBe("FR");
    const justPast = ((-90 + 31.5) * Math.PI) / 180;
    expect(stickySector(Math.cos(justPast), Math.sin(justPast), "F")).toBe("FR");
  });
});
