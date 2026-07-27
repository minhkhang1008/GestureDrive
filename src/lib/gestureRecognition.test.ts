import { describe, expect, it } from "vitest";
import { type DirectionCode } from "./commands";
import {
  analogDriveFromVector,
  ANCHOR_EDGE_MARGIN_SPAN,
  classifyAnchorPlacement,
  DEADZONE_ENTER_SPAN,
  DEADZONE_EXIT_SPAN,
  mirrorLandmarks,
  palmScalePlanar,
  sectorFromVector,
  stickySector,
  type Landmark,
} from "./gestureRecognition";

function point(x = 0.5, y = 0.5, z = 0): Landmark {
  return { x, y, z };
}

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

describe("mirroring", () => {
  it("flips x and preserves y/z", () => {
    const [mirrored] = mirrorLandmarks([point(0.2, 0.3, 0.1)]);
    expect(mirrored).toEqual({ x: 0.8, y: 0.3, z: 0.1 });
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

describe("joystick centre placement", () => {
  const ASPECT = 16 / 9;
  const SCALE = 0.2;
  const MARGIN = ANCHOR_EDGE_MARGIN_SPAN * SCALE; // 0.16

  it("accepts a hand near the middle of the frame", () => {
    expect(
      classifyAnchorPlacement({ x: ASPECT / 2, y: 0.5 }, SCALE, ASPECT),
    ).toBe("ok");
  });

  it("rejects a centre with no room to drag toward the nearest edge", () => {
    // A hand entering from the left: the origin would sit against the edge and
    // leaving no leftward travel at all is exactly the bug this guards.
    expect(classifyAnchorPlacement({ x: 0.05, y: 0.5 }, SCALE, ASPECT)).toBe(
      "near-edge",
    );
    expect(classifyAnchorPlacement({ x: ASPECT / 2, y: 0.02 }, SCALE, ASPECT)).toBe(
      "near-edge",
    );
    expect(classifyAnchorPlacement({ x: ASPECT / 2, y: 0.98 }, SCALE, ASPECT)).toBe(
      "near-edge",
    );
  });

  it("treats the margin as inclusive so the boundary itself is usable", () => {
    expect(classifyAnchorPlacement({ x: MARGIN, y: 0.5 }, SCALE, ASPECT)).toBe("ok");
    expect(classifyAnchorPlacement({ x: MARGIN - 1e-6, y: 0.5 }, SCALE, ASPECT)).toBe(
      "near-edge",
    );
    expect(classifyAnchorPlacement({ x: ASPECT / 2, y: MARGIN }, SCALE, ASPECT)).toBe(
      "ok",
    );
  });

  it("reports hand-too-large when no position in the frame could satisfy the margin", () => {
    // scale 0.7 needs 0.56 clearance on each side: 1.12 > frame height.
    expect(
      classifyAnchorPlacement({ x: ASPECT / 2, y: 0.5 }, 0.7, ASPECT),
    ).toBe("hand-too-large");
  });

  it("keeps the vertical axis the binding constraint on a wide frame", () => {
    // Frame height 1 is the tight axis at 16:9, so the cutoff is where the two
    // margins fill it exactly: scale = 1 / (2 * 0.8) = 0.625. Straddling that
    // value proves the vertical axis, not the wider horizontal one, decides.
    const centre = { x: ASPECT / 2, y: 0.5 };
    expect(classifyAnchorPlacement(centre, 0.62, ASPECT)).toBe("ok");
    expect(classifyAnchorPlacement(centre, 0.63, ASPECT)).toBe("hand-too-large");
    // Both still leave room horizontally, so x alone would have accepted them.
    expect(ANCHOR_EDGE_MARGIN_SPAN * 0.63 * 2).toBeLessThan(ASPECT);
  });
});
