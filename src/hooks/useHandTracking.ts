import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HandLandmarker,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { CommandCode } from "../lib/commands";
import {
  HAND_CONNECTIONS,
  handSpan,
  recognizeGesture,
  type Landmark,
} from "../lib/gestureRecognition";

export type TrackingStatus =
  | "idle"
  | "loading"
  | "ready"
  | "no-camera"
  | "denied"
  | "error";

export interface LiveGesture {
  code: CommandCode | null;
  name: string;
  confidence: number; // 0..1 stability of the current reading
}

interface Options {
  onStableCommand: (code: CommandCode) => void;
  stableFrames?: number;
}

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const ACCENT = "#3b82f6";
const JOINT = "#dbeafe";

export function useHandTracking({ onStableCommand, stableFrames = 4 }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handPresent, setHandPresent] = useState(false);
  const [fps, setFps] = useState(0);
  const [live, setLive] = useState<LiveGesture>({
    code: null,
    name: "Chưa có tín hiệu",
    confidence: 0,
  });

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // Stale-closure guard: always call the latest callback.
  const onStableRef = useRef(onStableCommand);
  useEffect(() => {
    onStableRef.current = onStableCommand;
  }, [onStableCommand]);

  // Rolling window of recent per-frame codes for stability + confidence.
  const historyRef = useRef<(CommandCode | null)[]>([]);
  const emittedRef = useRef<CommandCode | null>(null);
  const lastTsRef = useRef(0);
  const frameTimesRef = useRef<number[]>([]);

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
    const hands = result.landmarks;
    if (!hands.length) return;

    // Mirror to match the CSS-flipped video.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    for (const lm of hands as Landmark[][]) {
      const span = handSpan(lm);
      const w = Math.max(2, span * canvas.width * 0.02);

      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = w;
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
      for (let i = 0; i < lm.length; i++) {
        const r = i === 0 ? w * 1.6 : w * 1.1;
        ctx.beginPath();
        ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }, []);

  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!runningRef.current || !video || !landmarker) return;

    if (video.readyState >= 2) {
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const result = landmarker.detectForVideo(video, ts);
      drawOverlay(result);

      // fps over a 1s window
      const now = performance.now();
      const times = frameTimesRef.current;
      times.push(now);
      while (times.length && times[0] < now - 1000) times.shift();
      setFps(times.length);

      const hand = result.landmarks[0] as Landmark[] | undefined;
      const present = !!hand;
      setHandPresent(present);

      let code: CommandCode | null = null;
      let name = "Không thấy bàn tay";
      if (hand) {
        const handedness =
          (result.handedness?.[0]?.[0]?.categoryName as "Left" | "Right") ??
          "Right";
        const g = recognizeGesture(hand, handedness);
        code = g.code;
        name = g.name;
      }

      const hist = historyRef.current;
      hist.push(code);
      if (hist.length > 12) hist.shift();
      const confidence = hist.length
        ? hist.filter((c) => c === code).length / hist.length
        : 0;
      setLive({ code, name, confidence });

      // Stable = same non-null code for the last `stableFrames` frames.
      if (code && hist.length >= stableFrames) {
        const tail = hist.slice(-stableFrames);
        if (tail.every((c) => c === code) && emittedRef.current !== code) {
          emittedRef.current = code;
          onStableRef.current(code);
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [drawOverlay, stableFrames]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setError(null);
    setStatus("loading");
    try {
      if (!landmarkerRef.current) {
        // Lazy-load the vision runtime (~500 kB) only when the camera starts.
        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
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

      runningRef.current = true;
      setStatus("ready");
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === "NotAllowedError") {
        setStatus("denied");
        setError("Bạn đã từ chối quyền camera. Hãy cấp quyền rồi thử lại.");
      } else if (err?.name === "NotFoundError") {
        setStatus("no-camera");
        setError("Không tìm thấy camera nào trên máy này.");
      } else {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [loop]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    historyRef.current = [];
    emittedRef.current = null;
    setHandPresent(false);
    setLive({ code: null, name: "Đã tắt camera", confidence: 0 });
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
    fps,
    live,
    start,
    stop,
  };
}
