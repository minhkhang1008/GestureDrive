import type { Handedness, Landmark } from "./gestureRecognition";

export type HandLandmarkerDelegate = "GPU" | "CPU";

export interface TrackedHand {
  landmarks: Landmark[];
  handedness: Handedness;
  handednessScore: number;
}

export interface HandTrackingFrame {
  hands: TrackedHand[];
  inferenceMs: number;
  capturedAtMs: number;
  completedAtMs: number;
}

export type HandLandmarkerWorkerRequest =
  | { type: "initialize"; preferCpu?: boolean }
  | {
      type: "detect";
      frame: ImageBitmap;
      timestampMs: number;
      session: number;
    }
  | { type: "close" };

export type HandLandmarkerWorkerResponse =
  | {
      type: "ready";
      delegate: HandLandmarkerDelegate;
    }
  | {
      type: "result";
      session: number;
      result: HandTrackingFrame;
    }
  | {
      type: "error";
      phase: "initialize" | "detect";
      session: number | null;
      message: string;
    };
