import { useCallback, useEffect, useRef, useState } from "react";
import { createDirectionalDrive, type DirectionCode } from "../lib/commands";
import {
  sameControlCommand,
  STOP_COMMAND,
  type ControlCommand,
} from "../lib/controlTypes";
import {
  HAND_CONNECTIONS,
  DIRECTION_DEAD_ZONE,
  handSpan,
  palmCenter,
  recognizeDirection,
  recognizeSetupPose,
  recognizeSpeedGesture,
  screenSide,
  type Handedness,
  type Landmark,
  type Point,
  type ScreenSide,
  type SpeedGestureState,
} from "../lib/gestureRecognition";
import type {
  HandLandmarkerDelegate,
  HandLandmarkerWorkerRequest,
  HandLandmarkerWorkerResponse,
  HandTrackingFrame,
} from "../lib/handLandmarkerWorkerProtocol";

export type TrackingStatus =
  | "idle"
  | "loading"
  | "ready"
  | "no-camera"
  | "denied"
  | "error";

export type SetupStatus = "waiting" | "calibrating" | "ready";

export interface HandRoles {
  control: ScreenSide;
  speed: ScreenSide;
}

export interface LiveGesture {
  code: DirectionCode | null;
  name: string;
  confidence: number;
  speed: number;
  speedLocked: boolean;
  speedState: SpeedGestureState;
  roles: HandRoles | null;
  setupStatus: SetupStatus;
  orientationValid: boolean;
  handCount: number;
  controlAnchor: Point | null;
}

interface Options {
  onControlUpdate: (command: ControlCommand) => void;
  stableFrames?: number;
}

interface DetectedHand {
  landmarks: Landmark[];
  handedness: Handedness;
  center: Point;
  side: ScreenSide;
}

const ACCENT = "#3b82f6";
const JOINT = "#dbeafe";
const SETUP_STABLE_FRAMES = 6;
const SPEED_DEADBAND = 12;
const SPEED_INVALID_FRAMES_BEFORE_STOP = 2;
const ROLE_RESET_MS = 800;
const CAMERA_FRAME_TIMEOUT_MS = 180;
const WORKER_START_TIMEOUT_MS = 20_000;

const EMPTY_LIVE: LiveGesture = {
  code: null,
  name: "Đặt hai tay ở hai bên khung hình",
  confidence: 0,
  speed: 0,
  speedLocked: true,
  speedState: "invalid",
  roles: null,
  setupStatus: "waiting",
  orientationValid: true,
  handCount: 0,
  controlAnchor: null,
};

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useHandTracking({ onControlUpdate, stableFrames = 2 }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handPresent, setHandPresent] = useState(false);
  const [bothHandsPresent, setBothHandsPresent] = useState(false);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [pipelineLatencyMs, setPipelineLatencyMs] = useState(0);
  const [delegate, setDelegate] = useState<HandLandmarkerDelegate | null>(null);
  const [live, setLive] = useState<LiveGesture>(EMPTY_LIVE);

  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const framePendingRef = useRef(false);
  const sessionRef = useRef(0);
  const onControlRef = useRef(onControlUpdate);

  const rolesRef = useRef<HandRoles | null>(null);
  const controlAnchorRef = useRef<Point | null>(null);
  const setupHistoryRef = useRef<string[]>([]);
  const directionHistoryRef = useRef<DirectionCode[]>([]);
  const stableDirectionRef = useRef<DirectionCode>("S");
  const speedRef = useRef(0);
  const speedLockedRef = useRef(true);
  const speedInvalidFramesRef = useRef(0);
  const emittedRef = useRef<ControlCommand | null>(null);
  const bothMissingSinceRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastFreshFrameMsRef = useRef(0);
  const cameraStalledRef = useRef(false);
  const frameTimesRef = useRef<number[]>([]);

  useEffect(() => {
    onControlRef.current = onControlUpdate;
  }, [onControlUpdate]);

  const emit = useCallback((command: ControlCommand) => {
    if (sameControlCommand(emittedRef.current, command)) return;
    emittedRef.current = command;
    onControlRef.current(command);
  }, []);

  const resetRoles = useCallback(
    (emitStop: boolean) => {
      rolesRef.current = null;
      controlAnchorRef.current = null;
      setupHistoryRef.current = [];
      directionHistoryRef.current = [];
      stableDirectionRef.current = "S";
      speedRef.current = 0;
      speedLockedRef.current = true;
      speedInvalidFramesRef.current = 0;
      bothMissingSinceRef.current = null;
      emittedRef.current = null;
      setBothHandsPresent(false);
      setLive(EMPTY_LIVE);
      if (emitStop) emit(STOP_COMMAND);
    },
    [emit],
  );

  const drawOverlay = useCallback((result: HandTrackingFrame) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!result.hands.length) return;

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    for (const hand of result.hands) {
      const lm = hand.landmarks;
      const span = handSpan(lm);
      const width = Math.max(2, span * canvas.width * 0.02);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.9;

      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
        ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = JOINT;
      for (let index = 0; index < lm.length; index += 1) {
        const radius = index === 0 ? width * 1.6 : width * 1.1;
        ctx.beginPath();
        ctx.arc(
          lm[index].x * canvas.width,
          lm[index].y * canvas.height,
          radius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    ctx.restore();
  }, []);

  const toDetectedHands = useCallback(
    (result: HandTrackingFrame): DetectedHand[] =>
      result.hands.map(({ landmarks, handedness }) => {
        const center = palmCenter(landmarks);
        return {
          landmarks,
          handedness,
          center,
          side: screenSide(center),
        };
      }),
    [],
  );

  const processHands = useCallback(
    (result: HandTrackingFrame, now: number) => {
      const hands = toDetectedHands(result);
      const hasHands = hands.length > 0;
      setHandPresent(hasHands);

      if (!hasHands) {
        if (bothMissingSinceRef.current === null) {
          bothMissingSinceRef.current = now;
        }
        if (
          rolesRef.current &&
          now - bothMissingSinceRef.current >= ROLE_RESET_MS
        ) {
          resetRoles(true);
          return;
        }
      } else {
        bothMissingSinceRef.current = null;
      }

      const left = hands.find((hand) => hand.side === "left");
      const right = hands.find((hand) => hand.side === "right");
      const splitHands = left && right ? { left, right } : null;
      const roles = rolesRef.current;

      if (!roles) {
        setBothHandsPresent(false);
        let name = "Đặt hai tay ở hai bên khung hình";
        let setupStatus: SetupStatus = "waiting";

        if (splitHands) {
          const leftPose = recognizeSetupPose(
            splitHands.left.landmarks,
            splitHands.left.handedness,
          );
          const rightPose = recognizeSetupPose(
            splitHands.right.landmarks,
            splitHands.right.handedness,
          );
          const validPair =
            (leftPose === "open" && rightPose === "fist") ||
            (leftPose === "fist" && rightPose === "open");

          if (validPair) {
            const control: ScreenSide =
              leftPose === "open" ? "left" : "right";
            const speed: ScreenSide =
              control === "left" ? "right" : "left";
            const key = `${control}:${speed}`;
            const history = setupHistoryRef.current;
            history.push(key);
            if (history.length > SETUP_STABLE_FRAMES) history.shift();
            const stable =
              history.length === SETUP_STABLE_FRAMES &&
              history.every((item) => item === key);

            setupStatus = "calibrating";
            name = "Giữ nguyên để xác nhận vai trò hai tay";
            if (stable) {
              const nextRoles = { control, speed };
              const controlHand = splitHands[control];
              rolesRef.current = nextRoles;
              controlAnchorRef.current = controlHand.center;
              stableDirectionRef.current = "S";
              directionHistoryRef.current = [];
              speedRef.current = 0;
              speedLockedRef.current = true;
              speedInvalidFramesRef.current = 0;
              setBothHandsPresent(true);
              emit(STOP_COMMAND);
              setLive({
                ...EMPTY_LIVE,
                code: "S",
                name: "Đã xác nhận. Chụm ngón cái-trỏ để kéo tốc độ",
                roles: nextRoles,
                setupStatus: "ready",
                handCount: hands.length,
                controlAnchor: controlHand.center,
                speedState: "locked",
              });
              return;
            }
          } else {
            setupHistoryRef.current = [];
            name = "Xòe tay điều hướng, nắm tay tốc độ";
          }
        } else {
          setupHistoryRef.current = [];
        }

        setLive({
          ...EMPTY_LIVE,
          name,
          setupStatus,
          handCount: hands.length,
        });
        return;
      }

      const controlHand = splitHands?.[roles.control];
      const speedHand = splitHands?.[roles.speed];
      const pairReady = Boolean(controlHand && speedHand);
      setBothHandsPresent(pairReady);

      if (!controlHand || !speedHand || !controlAnchorRef.current) {
        directionHistoryRef.current = [];
        stableDirectionRef.current = "S";
        speedInvalidFramesRef.current = 0;
        emit(STOP_COMMAND);
        setLive({
          ...EMPTY_LIVE,
          code: "S",
          name: "Cần thấy đủ hai tay để tiếp tục",
          speed: speedRef.current,
          speedLocked: speedLockedRef.current,
          roles,
          setupStatus: "ready",
          handCount: hands.length,
          controlAnchor: controlAnchorRef.current,
        });
        return;
      }

      const direction = recognizeDirection(
        controlHand.landmarks,
        controlHand.handedness,
        controlAnchorRef.current,
      );
      const rawCode = direction.code ?? "S";
      const history = directionHistoryRef.current;
      history.push(rawCode);
      if (history.length > 12) history.shift();
      const confidence =
        history.filter((code) => code === rawCode).length / history.length;

      // STOP and an invalid palm orientation are safety signals, so they must
      // not wait for the movement debounce window.
      if (rawCode === "S" || !direction.orientationValid) {
        stableDirectionRef.current = "S";
        directionHistoryRef.current = [];
      } else if (history.length >= stableFrames) {
        const tail = history.slice(-stableFrames);
        if (tail.every((code) => code === rawCode)) {
          stableDirectionRef.current = rawCode;
        }
      }

      const speedGesture = recognizeSpeedGesture(
        speedHand.landmarks,
        speedHand.handedness,
        !speedLockedRef.current,
      );

      if (speedGesture.state === "invalid") {
        speedInvalidFramesRef.current += 1;
        const speedPoseLost =
          speedInvalidFramesRef.current >=
          SPEED_INVALID_FRAMES_BEFORE_STOP;
        if (speedPoseLost) {
          stableDirectionRef.current = "S";
          directionHistoryRef.current = [];
          emit(STOP_COMMAND);
        }
        setLive({
          code: speedPoseLost ? "S" : stableDirectionRef.current,
          name: speedPoseLost
            ? "Tay tốc độ không hợp lệ — xe đã dừng"
            : "Tay tốc độ: chụm ngón cái-trỏ để kéo",
          confidence,
          speed: speedRef.current,
          speedLocked: speedLockedRef.current,
          speedState: "invalid",
          roles,
          setupStatus: "ready",
          orientationValid: direction.orientationValid,
          handCount: hands.length,
          controlAnchor: controlAnchorRef.current,
        });
        return;
      }

      speedInvalidFramesRef.current = 0;
      if (
        speedGesture.state === "adjusting" &&
        speedGesture.value !== null &&
        Math.abs(speedGesture.value - speedRef.current) >= SPEED_DEADBAND
      ) {
        speedRef.current = speedGesture.value;
      }
      speedLockedRef.current = speedGesture.state === "locked";

      const command = createDirectionalDrive(
        stableDirectionRef.current,
        speedRef.current,
        speedLockedRef.current,
      );
      emit(command);

      setLive({
        code: stableDirectionRef.current,
        name: direction.name,
        confidence,
        speed: speedRef.current,
        speedLocked: speedLockedRef.current,
        speedState: speedGesture.state,
        roles,
        setupStatus: "ready",
        orientationValid: direction.orientationValid,
        handCount: hands.length,
        controlAnchor: controlAnchorRef.current,
      });
    },
    [emit, resetRoles, stableFrames, toDetectedHands],
  );

  const handleWorkerMessage = useCallback(
    (event: MessageEvent<HandLandmarkerWorkerResponse>) => {
      const response = event.data;
      if (response.type === "ready") {
        setDelegate(response.delegate);
        return;
      }

      if (response.type === "result") {
        if (
          !runningRef.current ||
          response.session !== sessionRef.current
        ) {
          return;
        }
        framePendingRef.current = false;

        const now = performance.now();
        setInferenceMs(response.result.inferenceMs);
        setPipelineLatencyMs(
          Math.max(0, now - response.result.capturedAtMs),
        );

        const times = frameTimesRef.current;
        times.push(now);
        while (times.length && times[0] < now - 1000) times.shift();
        setFps(times.length);

        drawOverlay(response.result);
        processHands(response.result, now);
        return;
      }

      if (
        response.phase === "detect" &&
        response.session !== sessionRef.current
      ) {
        return;
      }
      framePendingRef.current = false;

      runningRef.current = false;
      emit(STOP_COMMAND);
      setBothHandsPresent(false);
      setError(response.message);
      setStatus("error");
    },
    [drawOverlay, emit, processHands],
  );

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.onmessage = handleWorkerMessage;
    }
  }, [handleWorkerMessage]);

  const ensureWorker = useCallback(async (): Promise<Worker> => {
    if (workerRef.current) {
      workerRef.current.onmessage = handleWorkerMessage;
      return workerRef.current;
    }

    const worker = new Worker(
      new URL("../workers/handLandmarker.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Tải mô hình AI quá 20 giây."));
      }, WORKER_START_TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      const onMessage = (
        event: MessageEvent<HandLandmarkerWorkerResponse>,
      ) => {
        if (event.data.type === "ready") {
          cleanup();
          setDelegate(event.data.delegate);
          resolve();
        } else if (
          event.data.type === "error" &&
          event.data.phase === "initialize"
        ) {
          cleanup();
          reject(new Error(event.data.message));
        }
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "AI worker không khởi động được."));
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      const request: HandLandmarkerWorkerRequest = { type: "initialize" };
      worker.postMessage(request);
    });

    worker.onmessage = handleWorkerMessage;
    worker.onerror = (event) => {
      runningRef.current = false;
      framePendingRef.current = false;
      workerRef.current = null;
      setDelegate(null);
      emit(STOP_COMMAND);
      setBothHandsPresent(false);
      setError(event.message || "AI worker gặp lỗi.");
      setStatus("error");
    };
    return worker;
  }, [emit, handleWorkerMessage]);

  const queueFrame = useCallback((video: HTMLVideoElement) => {
    const worker = workerRef.current;
    if (!worker || framePendingRef.current) return;

    const session = sessionRef.current;
    const timestampMs = performance.now();
    framePendingRef.current = true;

    void createImageBitmap(video)
      .then((frame) => {
        if (
          !runningRef.current ||
          session !== sessionRef.current ||
          workerRef.current !== worker
        ) {
          frame.close();
          if (session === sessionRef.current) {
            framePendingRef.current = false;
          }
          return;
        }

        const request: HandLandmarkerWorkerRequest = {
          type: "detect",
          frame,
          timestampMs,
          session,
        };
        worker.postMessage(request, [frame]);
      })
      .catch((reason) => {
        if (!runningRef.current || session !== sessionRef.current) return;
        framePendingRef.current = false;
        runningRef.current = false;
        emit(STOP_COMMAND);
        setBothHandsPresent(false);
        setError(`Không chuyển được frame camera sang AI worker: ${messageFrom(reason)}`);
        setStatus("error");
      });
  }, [emit]);

  const loop = useCallback(() => {
    const video = videoRef.current;
    if (!runningRef.current || !video) return;

    const now = performance.now();
    const hasFreshFrame =
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTimeRef.current;

    if (hasFreshFrame) {
      lastVideoTimeRef.current = video.currentTime;
      lastFreshFrameMsRef.current = now;
      cameraStalledRef.current = false;
      queueFrame(video);
    } else if (
      !cameraStalledRef.current &&
      now - lastFreshFrameMsRef.current > CAMERA_FRAME_TIMEOUT_MS
    ) {
      cameraStalledRef.current = true;
      resetRoles(true);
      setHandPresent(false);
      setBothHandsPresent(false);
      setLive({
        ...EMPTY_LIVE,
        name: "Camera không còn frame mới. Cần setup lại",
      });
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [queueFrame, resetRoles]);

  const start = useCallback(async () => {
    if (runningRef.current || startingRef.current) return;

    startingRef.current = true;
    setError(null);
    setStatus("loading");
    let pendingStream: MediaStream | null = null;

    try {
      await ensureWorker();
      pendingStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: "user",
        },
        audio: false,
      });

      const video = videoRef.current;
      if (!video) throw new Error("Video element chưa sẵn sàng.");

      streamRef.current = pendingStream;
      video.srcObject = pendingStream;

      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            reject(new Error("Camera không trả metadata sau 5 giây."));
          }, 5000);
          video.onloadedmetadata = () => {
            window.clearTimeout(timeout);
            video.onloadedmetadata = null;
            resolve();
          };
        });
      }

      await video.play();

      resetRoles(false);
      sessionRef.current += 1;
      framePendingRef.current = false;
      frameTimesRef.current = [];
      lastVideoTimeRef.current = -1;
      lastFreshFrameMsRef.current = performance.now();
      cameraStalledRef.current = false;
      runningRef.current = true;
      setStatus("ready");
      rafRef.current = requestAnimationFrame(loop);
    } catch (reason) {
      pendingStream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === pendingStream) streamRef.current = null;

      const video = videoRef.current;
      if (video?.srcObject === pendingStream) video.srcObject = null;

      if (!delegate) {
        workerRef.current?.terminate();
        workerRef.current = null;
      }

      const cameraError = reason as DOMException;
      if (cameraError?.name === "NotAllowedError") {
        setStatus("denied");
        setError("Bạn đã từ chối quyền camera. Hãy cấp quyền rồi thử lại.");
      } else if (cameraError?.name === "NotFoundError") {
        setStatus("no-camera");
        setError("Không tìm thấy camera nào trên máy này.");
      } else {
        setStatus("error");
        setError(messageFrom(reason));
      }
    } finally {
      startingRef.current = false;
    }
  }, [delegate, ensureWorker, loop, resetRoles]);

  const stop = useCallback(() => {
    runningRef.current = false;
    sessionRef.current += 1;
    framePendingRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    resetRoles(true);
    setHandPresent(false);
    setFps(0);
    setInferenceMs(0);
    setPipelineLatencyMs(0);
    setStatus("idle");
  }, [resetRoles]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      sessionRef.current += 1;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    status,
    error,
    handPresent,
    bothHandsPresent,
    fps,
    inferenceMs,
    pipelineLatencyMs,
    delegate,
    live,
    directionDeadZone: DIRECTION_DEAD_ZONE,
    start,
    stop,
  };
}
