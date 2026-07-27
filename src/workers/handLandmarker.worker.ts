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

const CDN_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const CDN_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// Same-origin copies created by scripts/vendor-mediapipe.mjs. When present,
// AUTO mode works with no internet connection at all.
const LOCAL_WASM_URL = "/mediapipe/wasm";
const LOCAL_MODEL_URL = "/mediapipe/hand_landmarker.task";

interface AssetUrls {
  wasm: string;
  model: string;
}

async function resolveAssetUrls(): Promise<AssetUrls> {
  try {
    const response = await fetch(LOCAL_MODEL_URL, { method: "HEAD" });
    const contentType = response.headers.get("content-type") ?? "";
    // The dev server answers unknown paths with index.html — that is not the
    // model, so only accept a non-HTML 200.
    if (response.ok && !contentType.includes("text/html")) {
      return { wasm: LOCAL_WASM_URL, model: LOCAL_MODEL_URL };
    }
  } catch {
    // Vendored assets absent; use the CDN.
  }
  return { wasm: CDN_WASM_URL, model: CDN_MODEL_URL };
}

const workerScope = self as DedicatedWorkerGlobalScope;

// A GPU delegate that silently lands on a software rasterizer is slower than
// the CPU delegate and adds latency to every command. These thresholds decide
// when the worker gives up on it: a sustained majority of slow inferences over
// a full observation window, not one unlucky frame.
const SLOW_INFERENCE_MS = 55;
const SLOW_INFERENCE_WINDOW = 30;
const SLOW_INFERENCE_RATIO = 0.8;

let landmarker: HandLandmarker | null = null;
let delegate: HandLandmarkerDelegate = "GPU";
let initializePromise: Promise<void> | null = null;
let lastTimestampMs = 0;
let inferenceSamples = 0;
let slowInferences = 0;
let switchingDelegate = false;
let autoFallbackUsed = false;

function post(response: HandLandmarkerWorkerResponse): void {
  workerScope.postMessage(response);
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function createLandmarker(
  selectedDelegate: HandLandmarkerDelegate,
): Promise<HandLandmarker> {
  const assets = await resolveAssetUrls();
  // This is an ES module worker. The default classic WASM loader relies on
  // importScripts(), which is unavailable here and leaves ModuleFactory unset.
  const vision = await FilesetResolver.forVisionTasks(assets.wasm, true);
  if (selectedDelegate === "CPU") {
    // MediaPipe clears ModuleFactory after use. A distinct module URL makes
    // the CPU fallback execute the loader again instead of hitting ESM cache.
    vision.wasmLoaderPath += "?fallback=cpu";
  }
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: assets.model,
      delegate: selectedDelegate,
    },
    runningMode: "VIDEO",
    // One hand only. The steering hand carries both throttle and steering via
    // its displacement, so a second hand would double inference cost for
    // nothing. Halving numHands is the single biggest AI latency win here.
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
}

function warmUp(instance: HandLandmarker): void {
  // The first real inference otherwise pays for GPU shader compilation and
  // memory allocation, showing up as a several-hundred-ms hitch on frame one.
  try {
    const canvas = new OffscreenCanvas(64, 64);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#000";
    context.fillRect(0, 0, 64, 64);
    instance.detectForVideo(canvas, 0.001);
    lastTimestampMs = 0.001;
  } catch {
    // Warm-up is best effort; real frames will simply pay the cost instead.
  }
}

async function initialize(preferCpu: boolean): Promise<void> {
  if (landmarker) return;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    if (preferCpu) {
      delegate = "CPU";
      landmarker = await createLandmarker(delegate);
    } else {
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
    }
    warmUp(landmarker);
    // Already on CPU: there is nowhere left to fall back to.
    autoFallbackUsed = delegate === "CPU";
    inferenceSamples = 0;
    slowInferences = 0;
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

/**
 * Rebuilds the landmarker on the CPU delegate after the GPU one has proven
 * pathologically slow. Frames are dropped for the duration; the host watchdog
 * notices the silence and stops the vehicle, which is the correct behaviour
 * while no recognition is running.
 */
async function fallbackToCpu(): Promise<void> {
  if (switchingDelegate || autoFallbackUsed || delegate === "CPU") return;
  switchingDelegate = true;
  autoFallbackUsed = true;
  try {
    const previous = landmarker;
    landmarker = null;
    previous?.close();
    delegate = "CPU";
    const instance = await createLandmarker(delegate);
    warmUp(instance);
    landmarker = instance;
    post({ type: "ready", delegate });
  } catch (reason) {
    post({
      type: "error",
      phase: "initialize",
      session: null,
      message: messageFrom(reason),
    });
  } finally {
    switchingDelegate = false;
    inferenceSamples = 0;
    slowInferences = 0;
  }
}

function recordInferenceTime(durationMs: number): void {
  if (delegate !== "GPU" || autoFallbackUsed) return;
  inferenceSamples += 1;
  if (durationMs > SLOW_INFERENCE_MS) slowInferences += 1;
  if (inferenceSamples < SLOW_INFERENCE_WINDOW) return;
  const slowEnough = slowInferences >= SLOW_INFERENCE_WINDOW * SLOW_INFERENCE_RATIO;
  inferenceSamples = 0;
  slowInferences = 0;
  if (slowEnough) void fallbackToCpu();
}

function detect(
  frame: ImageBitmap,
  timestampMs: number,
  session: number,
): void {
  if (switchingDelegate) {
    // Mid-rebuild: dropping the frame is honest. Reporting zero hands would
    // claim the operator's hands had left the frame.
    frame.close();
    return;
  }
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
    const inferenceMs = completedAtMs - inferenceStartedAtMs;
    post({
      type: "result",
      session,
      result: {
        hands: serializeHands(result),
        inferenceMs,
        capturedAtMs,
        completedAtMs,
      },
    });
    recordInferenceTime(inferenceMs);
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
    void initialize(request.preferCpu ?? false).catch((reason) => {
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
