/// <reference lib="webworker" />

import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type {
  HandLandmarkerDelegate,
  HandLandmarkerWorkerRequest,
  HandLandmarkerWorkerResponse,
  TrackedHand,
} from "../lib/handLandmarkerWorkerProtocol";
import type { Handedness, Landmark } from "../lib/gestureRecognition";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const workerScope = self as DedicatedWorkerGlobalScope;

let landmarker: HandLandmarker | null = null;
let delegate: HandLandmarkerDelegate = "GPU";
let initializePromise: Promise<void> | null = null;
let lastTimestampMs = 0;

function post(response: HandLandmarkerWorkerResponse): void {
  workerScope.postMessage(response);
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function createLandmarker(
  selectedDelegate: HandLandmarkerDelegate,
): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: selectedDelegate,
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
}

async function initialize(): Promise<void> {
  if (landmarker) return;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    try {
      delegate = "GPU";
      landmarker = await createLandmarker(delegate);
    } catch (gpuReason) {
      console.warn(
        "Không khởi tạo được MediaPipe GPU trong worker; chuyển sang CPU.",
        gpuReason,
      );
      delegate = "CPU";
      landmarker = await createLandmarker(delegate);
    }
    post({ type: "ready", delegate });
  })();

  try {
    await initializePromise;
  } finally {
    initializePromise = null;
  }
}

function serializeHands(result: HandLandmarkerResult): TrackedHand[] {
  return result.landmarks.map((landmarks, index) => {
    const category = result.handedness[index]?.[0];
    return {
      landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })) as Landmark[],
      handedness: (category?.categoryName as Handedness | undefined) ?? "Right",
      handednessScore: category?.score ?? 0,
    };
  });
}

function detect(
  frame: ImageBitmap,
  timestampMs: number,
  session: number,
): void {
  if (!landmarker) {
    frame.close();
    post({
      type: "error",
      phase: "detect",
      session,
      message: "Mô hình nhận diện tay chưa sẵn sàng.",
    });
    return;
  }

  const capturedAtMs = timestampMs;
  const monotonicTimestamp = Math.max(timestampMs, lastTimestampMs + 0.001);
  lastTimestampMs = monotonicTimestamp;
  const inferenceStartedAtMs = performance.now();

  try {
    const result = landmarker.detectForVideo(frame, monotonicTimestamp);
    const completedAtMs = performance.now();
    post({
      type: "result",
      session,
      result: {
        hands: serializeHands(result),
        inferenceMs: completedAtMs - inferenceStartedAtMs,
        capturedAtMs,
        completedAtMs,
      },
    });
  } catch (reason) {
    post({
      type: "error",
      phase: "detect",
      session,
      message: messageFrom(reason),
    });
  } finally {
    frame.close();
  }
}

workerScope.onmessage = (event: MessageEvent<HandLandmarkerWorkerRequest>) => {
  const request = event.data;

  if (request.type === "initialize") {
    void initialize().catch((reason) => {
      post({
        type: "error",
        phase: "initialize",
        session: null,
        message: messageFrom(reason),
      });
    });
    return;
  }

  if (request.type === "detect") {
    detect(request.frame, request.timestampMs, request.session);
    return;
  }

  landmarker?.close();
  landmarker = null;
  workerScope.close();
};
