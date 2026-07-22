import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HandLandmarker,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  createDriveCommand,
  sameDriveCommand,
  STOP_COMMAND,
  type DirectionCode,
  type DriveCommand,
} from "../lib/commands";
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
  onControlUpdate: (command: DriveCommand) => void;
  stableFrames?: number;
}

interface DetectedHand {
  landmarks: Landmark[];
  handedness: Handedness;
  center: Point;
  side: ScreenSide;
}

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const ACCENT = "#3b82f6";
const JOINT = "#dbeafe";
const SETUP_STABLE_FRAMES = 8;
const SPEED_DEADBAND = 4;
const ROLE_RESET_MS = 800;

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

export function useHandTracking({ onControlUpdate, stableFrames = 4 }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handPresent, setHandPresent] = useState(false);
  const [bothHandsPresent, setBothHandsPresent] = useState(false);
  const [fps, setFps] = useState(0);
  const [live, setLive] = useState<LiveGesture>(EMPTY_LIVE);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const onControlRef = useRef(onControlUpdate);

  const rolesRef = useRef<HandRoles | null>(null);
  const controlAnchorRef = useRef<Point | null>(null);
  const setupHistoryRef = useRef<string[]>([]);
  const directionHistoryRef = useRef<DirectionCode[]>([]);
  const stableDirectionRef = useRef<DirectionCode>("S");
  const speedRef = useRef(0);
  const speedLockedRef = useRef(true);
  const emittedRef = useRef<DriveCommand | null>(null);
  const bothMissingSinceRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const frameTimesRef = useRef<number[]>([]);

  useEffect(() => {
    onControlRef.current = onControlUpdate;
  }, [onControlUpdate]);

  const emit = useCallback((command: DriveCommand) => {
    if (sameDriveCommand(emittedRef.current, command)) return;
    emittedRef.current = command;
    onControlRef.current(command);
  }, []);

  const resetRoles = useCallback((emitStop: boolean) => {
    rolesRef.current = null;
    controlAnchorRef.current = null;
    setupHistoryRef.current = [];
    directionHistoryRef.current = [];
    stableDirectionRef.current = "S";
    speedRef.current = 0;
    speedLockedRef.current = true;
    bothMissingSinceRef.current = null;
    emittedRef.current = null;
    setBothHandsPresent(false);
    setLive(EMPTY_LIVE);
    if (emitStop) emit(STOP_COMMAND);
  }, [emit]);

  const drawOverlay = useCallback((result: HandLandmarkerResult) => {
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
    if (!result.landmarks.length) return;

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    for (const lm of result.landmarks as Landmark[][]) {
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
      for (let i = 0; i < lm.length; i += 1) {
        const radius = i === 0 ? width * 1.6 : width * 1.1;
        ctx.beginPath();
        ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }, []);

  const toDetectedHands = useCallback((result: HandLandmarkerResult): DetectedHand[] => {
    return (result.landmarks as Landmark[][]).map((landmarks, index) => {
      const handedness =
        (result.handedness?.[index]?.[0]?.categoryName as Handedness) ?? "Right";
      const center = palmCenter(landmarks);
      return { landmarks, handedness, center, side: screenSide(center) };
    });
  }, []);

  const processHands = useCallback((result: HandLandmarkerResult, now: number) => {
    const hands = toDetectedHands(result);
    const hasHands = hands.length > 0;
    setHandPresent(hasHands);

    if (!hasHands) {
      if (bothMissingSinceRef.current === null) bothMissingSinceRef.current = now;
      if (rolesRef.current && now - bothMissingSinceRef.current >= ROLE_RESET_MS) {
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
          const control: ScreenSide = leftPose === "open" ? "left" : "right";
          const speed: ScreenSide = control === "left" ? "right" : "left";
          const key = `${control}:${speed}`;
          const history = setupHistoryRef.current;
          history.push(key);
          if (history.length > SETUP_STABLE_FRAMES) history.shift();
          const stable =
            history.length === SETUP_STABLE_FRAMES && history.every((item) => item === key);

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
            setBothHandsPresent(true);
            const stop = createDriveCommand("S", 0, true);
            emit(stop);
            setLive({
              ...EMPTY_LIVE,
              code: "S",
              name: "Đã xác nhận. Di chuyển tay điều hướng",
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
    const confidence = history.filter((code) => code === rawCode).length / history.length;

    if (history.length >= stableFrames) {
      const tail = history.slice(-stableFrames);
      if (tail.every((code) => code === rawCode)) stableDirectionRef.current = rawCode;
    }

    const speedGesture = recognizeSpeedGesture(speedHand.landmarks, speedHand.handedness);
    if (
      speedGesture.state === "adjusting" &&
      speedGesture.value !== null &&
      Math.abs(speedGesture.value - speedRef.current) >= SPEED_DEADBAND
    ) {
      speedRef.current = speedGesture.value;
    }
    if (speedGesture.state === "adjusting") speedLockedRef.current = false;
    if (speedGesture.state === "locked") speedLockedRef.current = true;

    const command = createDriveCommand(
      stableDirectionRef.current,
      speedRef.current,
      speedLockedRef.current,
    );
    emit(command);

    setLive({
      code: direction.code,
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
  }, [emit, resetRoles, stableFrames, toDetectedHands]);

  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!runningRef.current || !video || !landmarker) return;

    if (video.readyState >= 2) {
      let timestamp = performance.now();
      if (timestamp <= lastTsRef.current) timestamp = lastTsRef.current + 1;
      lastTsRef.current = timestamp;
      const result = landmarker.detectForVideo(video, timestamp);
      drawOverlay(result);

      const now = performance.now();
      const times = frameTimesRef.current;
      times.push(now);
      while (times.length && times[0] < now - 1000) times.shift();
      setFps(times.length);
      processHands(result, now);
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [drawOverlay, processHands]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setError(null);
    setStatus("loading");
    try {
      if (!landmarkerRef.current) {
        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Video element chưa sẵn sàng.");
      video.srcObject = stream;
      await video.play();

      resetRoles(false);
      runningRef.current = true;
      setStatus("ready");
      rafRef.current = requestAnimationFrame(loop);
    } catch (reason) {
      const cameraError = reason as DOMException;
      if (cameraError?.name === "NotAllowedError") {
        setStatus("denied");
        setError("Bạn đã từ chối quyền camera. Hãy cấp quyền rồi thử lại.");
      } else if (cameraError?.name === "NotFoundError") {
        setStatus("no-camera");
        setError("Không tìm thấy camera nào trên máy này.");
      } else {
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [loop, resetRoles]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    resetRoles(true);
    setHandPresent(false);
    setFps(0);
    setStatus("idle");
  }, [resetRoles]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
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
    live,
    directionDeadZone: DIRECTION_DEAD_ZONE,
    start,
    stop,
  };
}
