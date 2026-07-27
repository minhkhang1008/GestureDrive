import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectionCode } from "../lib/commands";
import {
  createDriveCommand,
  sameControlCommand,
  STOP_COMMAND,
  type ControlCommand,
} from "../lib/controlTypes";
import { clamp, ema, OneEuroFilter } from "../lib/filters";
import {
  analogDriveFromVector,
  DEADZONE_ENTER_SPAN,
  directionName,
  fingersUp,
  FULL_DEFLECTION_SPAN,
  HAND_CONNECTIONS,
  handSpan,
  mirrorLandmarks,
  ORIENTATION_GATE_THROTTLE,
  recognizeSetupPose,
  recognizeSpeedPose,
  resolvePalmOrientation,
  stickySector,
  type Handedness,
  type PalmOrientation,
  type Point,
  type ScreenSide,
  type SpeedGestureState,
} from "../lib/gestureRecognition";
import {
  HandTracker,
  MIN_DRIVE_QUALITY,
  observeHand,
  predictCenter,
  type HandTrack,
} from "../lib/handTracking";
import { SpeedSlider } from "../lib/speedControl";
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
  /** Display sector; null while the palm orientation blocks the command. */
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
  /** Quantized analog channels actually being emitted (-1000..1000). */
  throttle: number;
  steering: number;
  /** 0..1 joystick deflection after dead zone + expo. */
  deflection: number;
  /** True while the AI-result watchdog has tripped. */
  stalled: boolean;
  /** 0..1 worst tracking quality across the two role hands. */
  quality: number;
  /** True while a role hand is rebuilding confidence after a rejected jump. */
  reacquiring: boolean;
}

interface Options {
  onControlUpdate: (command: ControlCommand, label: string) => void;
}

/**
 * A driving role bound to a tracked hand. The id is the primary key, so the
 * role follows the physical hand across the screen midline. Handedness and the
 * last known side are the fallback used to re-bind the role when the tracker
 * has to drop and re-create the track.
 */
interface RoleBinding {
  id: number;
  handedness: Handedness;
  side: ScreenSide;
}

interface RoleBindings {
  control: RoleBinding;
  speed: RoleBinding;
}

interface HudState {
  anchor: Point;
  palm: Point;
  scale: number;
  active: boolean;
  orientationValid: boolean;
}

const ACCENT = "#3b82f6";
const JOINT = "#dbeafe";
const STOPPED = "#ef4444";
const MARGINAL = "#f59e0b";

const SETUP_STABLE_FRAMES = 6;
const ROLE_RESET_MS = 800;
/**
 * How long a role may stay bound while its hand is unavailable. The vehicle is
 * stopped for the whole window; this only decides how long the operator has to
 * bring the hand back before the open/fist setup has to be repeated.
 */
const ROLE_REBIND_GRACE_MS = 800;
const CAMERA_FRAME_TIMEOUT_MS = 250;
const WORKER_START_TIMEOUT_MS = 20_000;
/** Watchdog: silence from the AI worker longer than this forces STOP. */
const RESULT_STALL_MS = 350;
const WATCHDOG_INTERVAL_MS = 150;
const DETECT_ERRORS_BEFORE_RECYCLE = 5;
/** Longest frame edge sent to the worker; the model needs far less than 720p. */
const CAPTURE_MAX_HEIGHT = 360;
/** Channel quantization step: bounds serial churn without visible coarseness. */
const CHANNEL_STEP = 20;
const ANCHOR_RECENTER_ALPHA = 0.03;
const CONFIDENCE_WINDOW = 15;

const EMPTY_LIVE: LiveGesture = {
  code: null,
  name: "Đặt hai tay ở hai bên khung hình",
  confidence: 0,
  speed: 0,
  speedLocked: true,
  speedState: "absent",
  roles: null,
  setupStatus: "waiting",
  orientationValid: true,
  handCount: 0,
  controlAnchor: null,
  throttle: 0,
  steering: 0,
  deflection: 0,
  stalled: false,
  quality: 0,
  reacquiring: false,
};

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function quantizeChannel(value: number): number {
  return clamp(Math.round(value / CHANNEL_STEP) * CHANNEL_STEP, -1000, 1000);
}

function sameRoles(a: HandRoles | null, b: HandRoles | null): boolean {
  if (a === null || b === null) return a === b;
  return a.control === b.control && a.speed === b.speed;
}

function sameLive(a: LiveGesture, b: LiveGesture): boolean {
  return (
    a.code === b.code &&
    a.name === b.name &&
    a.confidence === b.confidence &&
    a.speed === b.speed &&
    a.speedLocked === b.speedLocked &&
    a.speedState === b.speedState &&
    sameRoles(a.roles, b.roles) &&
    a.setupStatus === b.setupStatus &&
    a.orientationValid === b.orientationValid &&
    a.handCount === b.handCount &&
    a.throttle === b.throttle &&
    a.steering === b.steering &&
    a.deflection === b.deflection &&
    a.stalled === b.stalled &&
    a.quality === b.quality &&
    a.reacquiring === b.reacquiring &&
    (a.controlAnchor === b.controlAnchor ||
      (a.controlAnchor !== null &&
        b.controlAnchor !== null &&
        a.controlAnchor.x === b.controlAnchor.x &&
        a.controlAnchor.y === b.controlAnchor.y))
  );
}

/** Rounded to keep publishLive from re-rendering on float noise. */
function quantizeQuality(value: number): number {
  return Math.round(value * 20) / 20;
}

export function useHandTracking({ onControlUpdate }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handPresent, setHandPresent] = useState(false);
  const [driveReady, setDriveReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [pipelineLatencyMs, setPipelineLatencyMs] = useState(0);
  const [delegate, setDelegate] = useState<HandLandmarkerDelegate | null>(null);
  const [live, setLive] = useState<LiveGesture>(EMPTY_LIVE);

  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const vfcHandleRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const framePendingRef = useRef(false);
  const sessionRef = useRef(0);
  const preferCpuRef = useRef(false);
  const detectErrorsRef = useRef(0);
  const workerRecycledRef = useRef(false);
  const onControlRef = useRef(onControlUpdate);

  const trackerRef = useRef<HandTracker>(new HandTracker(16 / 9));
  const roleBindingsRef = useRef<RoleBindings | null>(null);
  const roleMissingSinceRef = useRef<number | null>(null);
  const controlAnchorRef = useRef<Point | null>(null);
  const setupHistoryRef = useRef<string[]>([]);
  // Per-track gesture memory (finger and palm-orientation hysteresis), keyed by
  // the tracker's stable id so it follows the hand instead of the screen half.
  const fingerStateRef = useRef(new Map<number, boolean[]>());
  const orientationStateRef = useRef(new Map<number, PalmOrientation>());
  const driveActiveRef = useRef(false);
  const sectorRef = useRef<DirectionCode>("S");
  const confidenceWindowRef = useRef<DirectionCode[]>([]);
  const pinchFilterRef = useRef(new OneEuroFilter({ minCutoffHz: 1.2, beta: 0.02 }));
  const speedSliderRef = useRef(new SpeedSlider());
  const speedLockedRef = useRef(true);
  const emittedRef = useRef<ControlCommand | null>(null);
  const bothMissingSinceRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastFreshFrameMsRef = useRef(0);
  const lastResultAtRef = useRef(0);
  const stalledRef = useRef(false);
  const cameraStalledRef = useRef(false);
  const frameTimesRef = useRef<number[]>([]);
  const lastStatsUpdateRef = useRef(0);
  const liveRef = useRef<LiveGesture>(EMPTY_LIVE);
  const hudRef = useRef<HudState | null>(null);
  const videoAspectRef = useRef(16 / 9);
  /** Smoothed capture-to-result latency, used for the prediction horizon. */
  const latencyMsRef = useRef(0);
  /** Worst role-hand quality of the last frame, for the overlay tint. */
  const overlayQualityRef = useRef(1);

  useEffect(() => {
    onControlRef.current = onControlUpdate;
  }, [onControlUpdate]);

  const emit = useCallback((command: ControlCommand, label: string) => {
    if (sameControlCommand(emittedRef.current, command)) return;
    emittedRef.current = command;
    onControlRef.current(command, label);
  }, []);

  const publishLive = useCallback((next: LiveGesture) => {
    if (sameLive(liveRef.current, next)) return;
    liveRef.current = next;
    setLive(next);
  }, []);

  const resetRoles = useCallback(
    (emitStop: boolean) => {
      roleBindingsRef.current = null;
      roleMissingSinceRef.current = null;
      controlAnchorRef.current = null;
      setupHistoryRef.current = [];
      trackerRef.current.reset();
      fingerStateRef.current.clear();
      orientationStateRef.current.clear();
      driveActiveRef.current = false;
      sectorRef.current = "S";
      confidenceWindowRef.current = [];
      pinchFilterRef.current.reset();
      speedSliderRef.current.reset();
      speedLockedRef.current = true;
      bothMissingSinceRef.current = null;
      emittedRef.current = null;
      hudRef.current = null;
      overlayQualityRef.current = 1;
      setDriveReady(false);
      publishLive(EMPTY_LIVE);
      if (emitStop) emit(STOP_COMMAND, "Gesture STOP");
    },
    [emit, publishLive],
  );

  // -------------------------------------------------------------------------
  // Overlay: skeleton + analog joystick HUD, all drawn in the same mirrored
  // video-pixel space so object-cover cropping can never misalign them.
  // -------------------------------------------------------------------------
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
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // The skeleton itself carries the tracking verdict: blue while the hands
    // are trusted, amber while quality is marginal, red once a role hand is
    // untrusted enough that the vehicle is being stopped.
    const quality = overlayQualityRef.current;
    const skeleton =
      quality >= 0.75 ? ACCENT : quality >= MIN_DRIVE_QUALITY ? MARGINAL : STOPPED;

    for (const hand of result.hands) {
      const landmarks = hand.landmarks;
      const span = handSpan(landmarks);
      const lineWidth = Math.max(2, span * width * 0.02);
      ctx.strokeStyle = skeleton;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.9;

      for (const [a, b] of HAND_CONNECTIONS) {
        const from = landmarks[a];
        const to = landmarks[b];
        if (!from || !to) continue;
        ctx.beginPath();
        ctx.moveTo(from.x * width, from.y * height);
        ctx.lineTo(to.x * width, to.y * height);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = JOINT;
      for (let index = 0; index < landmarks.length; index += 1) {
        const landmark = landmarks[index];
        if (!landmark) continue;
        const radius = index === 0 ? lineWidth * 1.6 : lineWidth * 1.1;
        ctx.beginPath();
        ctx.arc(landmark.x * width, landmark.y * height, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const hud = hudRef.current;
    if (!hud) return;

    // Planar space: x was multiplied by aspect, so one planar unit equals the
    // frame height in pixels on both axes.
    const aspect = videoAspectRef.current;
    const anchorX = (hud.anchor.x / aspect) * width;
    const anchorY = hud.anchor.y * height;
    const palmX = (hud.palm.x / aspect) * width;
    const palmY = hud.palm.y * height;
    const spanPx = hud.scale * height;
    const color = !hud.orientationValid
      ? STOPPED
      : hud.active
        ? ACCENT
        : "rgba(255,255,255,0.75)";

    // Dead zone ring (enter radius) and full-deflection ring.
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, DEADZONE_ENTER_SPAN * spanPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, FULL_DEFLECTION_SPAN * spanPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Live displacement vector.
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(palmX, palmY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(palmX, palmY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }, []);

  // -------------------------------------------------------------------------
  // Gesture logic
  // -------------------------------------------------------------------------
  const processHands = useCallback(
    (result: HandTrackingFrame, now: number) => {
      const aspect = videoAspectRef.current;
      const observations = result.hands.map((hand) =>
        observeHand(hand.landmarks, hand.handedness, hand.handednessScore, aspect),
      );
      const tracks = trackerRef.current.update(observations, now);
      const byId = new Map(tracks.map((track) => [track.id, track] as const));

      // Per-track gesture memory lives exactly as long as its track.
      for (const id of [...fingerStateRef.current.keys()]) {
        if (!byId.has(id)) fingerStateRef.current.delete(id);
      }
      for (const id of [...orientationStateRef.current.keys()]) {
        if (!byId.has(id)) orientationStateRef.current.delete(id);
      }

      const hasHands = tracks.length > 0;
      setHandPresent(hasHands);

      if (!hasHands) {
        if (bothMissingSinceRef.current === null) {
          bothMissingSinceRef.current = now;
        }
        if (
          roleBindingsRef.current &&
          now - bothMissingSinceRef.current >= ROLE_RESET_MS
        ) {
          resetRoles(true);
          return;
        }
      } else {
        bothMissingSinceRef.current = null;
      }

      const readFingers = (track: HandTrack): boolean[] => {
        const fingers = fingersUp(
          track.landmarks,
          fingerStateRef.current.get(track.id) ?? null,
        );
        fingerStateRef.current.set(track.id, fingers);
        return fingers;
      };

      // --- Role setup: one open hand and one fist, on opposite halves -------
      if (!roleBindingsRef.current) {
        // No role hand is bound yet, so there is no drive verdict to tint by.
        overlayQualityRef.current = 1;
        setDriveReady(false);
        let name = "Đặt hai tay ở hai bên khung hình";
        let setupStatus: SetupStatus = "waiting";

        const usable = tracks.filter(
          (track) => !track.coasting && track.quality >= MIN_DRIVE_QUALITY,
        );
        const leftHands = usable.filter((track) => track.side === "left");
        const rightHands = usable.filter((track) => track.side === "right");
        const leftHand = leftHands.length === 1 ? leftHands[0] : undefined;
        const rightHand = rightHands.length === 1 ? rightHands[0] : undefined;

        if (leftHand && rightHand && usable.length === 2) {
          const leftPose = recognizeSetupPose(readFingers(leftHand));
          const rightPose = recognizeSetupPose(readFingers(rightHand));
          const validPair =
            (leftPose === "open" && rightPose === "fist") ||
            (leftPose === "fist" && rightPose === "open");

          if (validPair) {
            const controlHand = leftPose === "open" ? leftHand : rightHand;
            const speedHand = controlHand === leftHand ? rightHand : leftHand;
            const key = `${controlHand.id}:${speedHand.id}`;
            const history = setupHistoryRef.current;
            history.push(key);
            if (history.length > SETUP_STABLE_FRAMES) history.shift();
            const stable =
              history.length === SETUP_STABLE_FRAMES &&
              history.every((item) => item === key);

            setupStatus = "calibrating";
            name = "Giữ nguyên để xác nhận vai trò hai tay";
            if (stable) {
              const nextRoles: HandRoles = {
                control: controlHand.side,
                speed: speedHand.side,
              };
              roleBindingsRef.current = {
                control: {
                  id: controlHand.id,
                  handedness: controlHand.handedness,
                  side: controlHand.side,
                },
                speed: {
                  id: speedHand.id,
                  handedness: speedHand.handedness,
                  side: speedHand.side,
                },
              };
              roleMissingSinceRef.current = null;
              controlAnchorRef.current = { ...controlHand.smoothedCenter };
              driveActiveRef.current = false;
              sectorRef.current = "S";
              confidenceWindowRef.current = [];
              pinchFilterRef.current.reset();
              speedSliderRef.current.reset();
              speedLockedRef.current = true;
              setDriveReady(true);
              emit(STOP_COMMAND, "Gesture STOP");
              publishLive({
                ...EMPTY_LIVE,
                code: "S",
                name: "Đã xác nhận. Chụm ngón cái-trỏ để kéo tốc độ",
                roles: nextRoles,
                setupStatus: "ready",
                handCount: tracks.length,
                controlAnchor: {
                  x: controlHand.smoothedCenter.x / aspect,
                  y: controlHand.smoothedCenter.y,
                },
                speedState: "locked",
                quality: quantizeQuality(
                  Math.min(controlHand.quality, speedHand.quality),
                ),
              });
              return;
            }
          } else {
            setupHistoryRef.current = [];
            name = "Xòe tay điều hướng, nắm tay tốc độ";
          }
        } else {
          setupHistoryRef.current = [];
          if (tracks.length >= 2) {
            name = "Giữ hai tay rõ nét ở hai nửa khung hình";
          }
        }

        publishLive({
          ...EMPTY_LIVE,
          name,
          setupStatus,
          handCount: tracks.length,
          quality: quantizeQuality(
            usable.length === 0
              ? 0
              : Math.min(...usable.map((track) => track.quality)),
          ),
        });
        return;
      }

      // --- Resolve the two role hands --------------------------------------
      const bindings = roleBindingsRef.current;
      let controlHand = byId.get(bindings.control.id);
      let speedHand = byId.get(bindings.speed.id);

      // A dropped track does not have to cost the operator the whole setup:
      // an unclaimed, trusted hand of the same handedness on the same side is
      // accepted as the same physical hand coming back.
      const rebind = (binding: RoleBinding, takenId: number | undefined) => {
        const candidate = tracks.find(
          (track) =>
            track.id !== takenId &&
            !track.coasting &&
            track.quality >= MIN_DRIVE_QUALITY &&
            track.handedness === binding.handedness &&
            track.side === binding.side,
        );
        if (candidate) binding.id = candidate.id;
        return candidate;
      };
      if (!controlHand) {
        controlHand = rebind(bindings.control, speedHand?.id);
        if (controlHand) {
          // The hand came back somewhere else in the frame. Keeping the old
          // anchor would read that offset as a large deflection and launch the
          // vehicle, so the joystick re-centers on where the hand actually is.
          controlAnchorRef.current = { ...controlHand.smoothedCenter };
          driveActiveRef.current = false;
          sectorRef.current = "S";
        }
      }
      if (!speedHand) {
        speedHand = rebind(bindings.speed, controlHand?.id);
        if (speedHand) {
          // A pinch that was in progress when the hand vanished must not resume
          // against a stale grab point; SpeedSlider.hold() already released the
          // grab, this clears the filter that fed it.
          pinchFilterRef.current.reset();
        }
      }

      const roles: HandRoles = {
        control: controlHand?.side ?? bindings.control.side,
        speed: speedHand?.side ?? bindings.speed.side,
      };
      const anchor = controlAnchorRef.current;

      // The control hand is the dead-man. The speed hand only sets a ceiling,
      // so once that ceiling is chosen it may leave the frame: the value is
      // held and driving continues one-handed.
      const controlTrusted =
        controlHand !== undefined && controlHand.quality >= MIN_DRIVE_QUALITY;
      const speedTrusted =
        speedHand !== undefined && speedHand.quality >= MIN_DRIVE_QUALITY;
      const canDrive = controlTrusted && anchor !== null;
      setDriveReady(canDrive);

      if (controlHand) {
        // Remember where the hand currently is, so a later re-bind looks for it
        // on the side it was actually last seen on.
        bindings.control.side = controlHand.side;
        roleMissingSinceRef.current = null;
      } else if (roleMissingSinceRef.current === null) {
        roleMissingSinceRef.current = now;
      } else if (now - roleMissingSinceRef.current >= ROLE_REBIND_GRACE_MS) {
        // The control hand never came back: fall back to open/fist setup. A
        // missing speed hand never triggers this — it is allowed to stay away.
        resetRoles(true);
        return;
      }
      if (speedHand) bindings.speed.side = speedHand.side;

      // --- Speed hand: pinch = grab slider, drag vertically, release = lock -
      // Runs before the drive gate so the ceiling can still be adjusted while
      // the control hand is down.
      const slider = speedSliderRef.current;
      let speedResult;
      if (speedHand && speedTrusted) {
        const speedPose = recognizeSpeedPose(
          speedHand.landmarks,
          fingerStateRef.current.get(speedHand.id) ?? null,
          slider.isPinching(),
          aspect,
        );
        fingerStateRef.current.set(speedHand.id, speedPose.fingers);
        speedResult = slider.apply(
          speedPose.state,
          pinchFilterRef.current.filter(speedPose.pinchY, now),
          speedHand.scale,
        );
      } else {
        pinchFilterRef.current.reset();
        speedResult = slider.hold();
      }
      speedLockedRef.current = speedResult.locked;

      // Only the control hand can stop the vehicle now, so only its
      // re-acquisition raises the banner.
      const quality = controlHand?.quality ?? 0;
      const reacquiring = Boolean(controlHand?.reacquiring);
      overlayQualityRef.current = quality;

      if (!canDrive || !controlHand || !anchor) {
        driveActiveRef.current = false;
        sectorRef.current = "S";
        hudRef.current = null;
        emit(STOP_COMMAND, "Gesture STOP");
        publishLive({
          ...EMPTY_LIVE,
          code: "S",
          name: reacquiring
            ? "Đang bắt lại bàn tay — xe đã dừng"
            : controlHand
              ? "Tín hiệu tay điều hướng chưa đủ tin cậy — xe đã dừng"
              : "Cần thấy tay điều hướng để tiếp tục",
          speed: speedResult.value,
          speedLocked: speedResult.locked,
          speedState: speedResult.gesture,
          roles,
          setupStatus: "ready",
          handCount: tracks.length,
          controlAnchor: anchor ? { x: anchor.x / aspect, y: anchor.y } : null,
          quality: quantizeQuality(quality),
          reacquiring,
        });
        return;
      }

      // --- Control hand: filtered planar displacement -> analog drive ------
      // Latency compensation: aim the joystick at where the hand is now, not
      // where it was when the frame was captured.
      const filteredPalm = predictCenter(controlHand, latencyMsRef.current);
      const scaleEma = controlHand.scale;

      const dxSpan = (filteredPalm.x - anchor.x) / scaleEma;
      const dySpan = (filteredPalm.y - anchor.y) / scaleEma;
      const analog = analogDriveFromVector(dxSpan, dySpan, driveActiveRef.current);

      const orientation = resolvePalmOrientation(
        controlHand.landmarks,
        controlHand.handedness,
        orientationStateRef.current.get(controlHand.id) ?? null,
        aspect,
      );
      orientationStateRef.current.set(controlHand.id, orientation);

      const wantsForward = analog.throttle > ORIENTATION_GATE_THROTTLE;
      const wantsReverse = analog.throttle < -ORIENTATION_GATE_THROTTLE;
      const orientationValid =
        !analog.active ||
        (!(wantsForward && orientation === "back") &&
          !(wantsReverse && orientation === "palm"));

      // Slowly re-center the anchor while resting in the dead zone so slow
      // posture drift never turns into a phantom command.
      if (!analog.active) {
        anchor.x = ema(anchor.x, filteredPalm.x, ANCHOR_RECENTER_ALPHA);
        anchor.y = ema(anchor.y, filteredPalm.y, ANCHOR_RECENTER_ALPHA);
      }

      driveActiveRef.current = analog.active && orientationValid;

      const sector: DirectionCode = driveActiveRef.current
        ? stickySector(dxSpan, dySpan, sectorRef.current)
        : "S";
      sectorRef.current = sector;

      const window = confidenceWindowRef.current;
      window.push(sector);
      if (window.length > CONFIDENCE_WINDOW) window.shift();
      const confidence =
        window.filter((code) => code === sector).length / window.length;

      hudRef.current = {
        anchor: { x: anchor.x, y: anchor.y },
        palm: filteredPalm,
        scale: scaleEma,
        active: driveActiveRef.current,
        orientationValid,
      };

      // --- Emit ------------------------------------------------------------
      const throttle = quantizeChannel(analog.throttle);
      const steering = quantizeChannel(analog.steering);
      let name: string;
      let command: ControlCommand;

      if (!orientationValid) {
        command = STOP_COMMAND;
        name =
          analog.throttle > 0
            ? "Hướng lòng bàn tay vào camera để tiến"
            : "Hướng mu bàn tay vào camera để lùi";
        emit(command, "Gesture STOP");
      } else if (!driveActiveRef.current) {
        command = STOP_COMMAND;
        name = directionName("S");
        emit(command, "Gesture STOP");
      } else {
        command = createDriveCommand(throttle, steering, speedResult.value, {
          speedLocked: speedResult.locked,
        });
        name = directionName(sector);
        emit(command, `Gesture ${sector}`);
      }

      publishLive({
        code: orientationValid ? sector : null,
        name,
        confidence: Math.round(confidence * 100) / 100,
        speed: speedResult.value,
        speedLocked: speedResult.locked,
        speedState: speedResult.gesture,
        roles,
        setupStatus: "ready",
        orientationValid,
        handCount: tracks.length,
        controlAnchor: { x: anchor.x / aspect, y: anchor.y },
        throttle: driveActiveRef.current ? throttle : 0,
        steering: driveActiveRef.current ? steering : 0,
        deflection: Math.round(analog.deflection * 100) / 100,
        stalled: false,
        quality: quantizeQuality(quality),
        reacquiring,
      });
    },
    [emit, publishLive, resetRoles],
  );

  // -------------------------------------------------------------------------
  // Worker plumbing
  // -------------------------------------------------------------------------
  const recycleWorker = useCallback(() => {
    // Too many consecutive detect failures: assume the delegate is broken and
    // rebuild the worker once, forcing the CPU path. STOP stays latched by the
    // watchdog until results flow again.
    workerRef.current?.terminate();
    workerRef.current = null;
    framePendingRef.current = false;
    detectErrorsRef.current = 0;
    if (workerRecycledRef.current) {
      runningRef.current = false;
      emit(STOP_COMMAND, "Gesture STOP");
      setDriveReady(false);
      setError("AI worker lỗi liên tục, đã dừng nhận diện.");
      setStatus("error");
      return;
    }
    workerRecycledRef.current = true;
    preferCpuRef.current = true;
    setDelegate(null);
  }, [emit]);

  const handleWorkerMessage = useCallback(
    (event: MessageEvent<HandLandmarkerWorkerResponse>) => {
      const response = event.data;
      if (response.type === "ready") {
        setDelegate(response.delegate);
        return;
      }

      if (response.type === "result") {
        if (!runningRef.current || response.session !== sessionRef.current) {
          return;
        }
        framePendingRef.current = false;
        detectErrorsRef.current = 0;

        const now = performance.now();
        lastResultAtRef.current = now;
        stalledRef.current = false;

        const times = frameTimesRef.current;
        times.push(now);
        while (times.length && (times[0] ?? 0) < now - 1000) times.shift();

        // Capture-to-result latency drives the prediction horizon, so it is
        // smoothed every frame even though the UI only reads it at 4 Hz.
        const latencyMs = Math.max(0, now - response.result.capturedAtMs);
        latencyMsRef.current = ema(latencyMsRef.current, latencyMs, 0.2);

        if (now - lastStatsUpdateRef.current >= 250) {
          lastStatsUpdateRef.current = now;
          setInferenceMs(response.result.inferenceMs);
          setPipelineLatencyMs(latencyMs);
          setFps(times.length);
        }

        // Mirror once at ingestion: every downstream consumer (gesture logic
        // and overlay drawing) works in the user-facing mirrored space.
        const mirrored: HandTrackingFrame = {
          ...response.result,
          hands: response.result.hands.map((hand) => ({
            ...hand,
            landmarks: mirrorLandmarks(hand.landmarks),
          })),
        };

        processHands(mirrored, now);
        drawOverlay(mirrored);
        return;
      }

      if (response.phase === "detect") {
        if (response.session !== sessionRef.current) return;
        framePendingRef.current = false;
        detectErrorsRef.current += 1;
        emit(STOP_COMMAND, "Gesture STOP");
        if (detectErrorsRef.current >= DETECT_ERRORS_BEFORE_RECYCLE) {
          recycleWorker();
        }
        return;
      }

      framePendingRef.current = false;
      runningRef.current = false;
      emit(STOP_COMMAND, "Gesture STOP");
      setDriveReady(false);
      setError(response.message);
      setStatus("error");
    },
    [drawOverlay, emit, processHands, recycleWorker],
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
      const onMessage = (event: MessageEvent<HandLandmarkerWorkerResponse>) => {
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
      const request: HandLandmarkerWorkerRequest = {
        type: "initialize",
        preferCpu: preferCpuRef.current,
      };
      worker.postMessage(request);
    });

    worker.onmessage = handleWorkerMessage;
    worker.onerror = (event) => {
      runningRef.current = false;
      framePendingRef.current = false;
      workerRef.current = null;
      setDelegate(null);
      emit(STOP_COMMAND, "Gesture STOP");
      setDriveReady(false);
      setError(event.message || "AI worker gặp lỗi.");
      setStatus("error");
    };
    return worker;
  }, [emit, handleWorkerMessage]);

  const queueFrame = useCallback(
    (video: HTMLVideoElement) => {
      const worker = workerRef.current;
      if (!worker || framePendingRef.current) return;

      const session = sessionRef.current;
      const timestampMs = performance.now();
      framePendingRef.current = true;

      // Downscale at capture: the landmark model consumes ~224 px inputs, so
      // shipping full 720p bitmaps only adds copy and preprocessing cost.
      const videoHeight = video.videoHeight || 720;
      const videoWidth = video.videoWidth || 1280;
      const scale = Math.min(1, CAPTURE_MAX_HEIGHT / videoHeight);
      const resize =
        scale < 1
          ? {
              resizeWidth: Math.round(videoWidth * scale),
              resizeHeight: Math.round(videoHeight * scale),
              resizeQuality: "low" as const,
            }
          : undefined;

      void createImageBitmap(video, resize ?? {})
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
          emit(STOP_COMMAND, "Gesture STOP");
          setDriveReady(false);
          setError(
            `Không chuyển được frame camera sang AI worker: ${messageFrom(reason)}`,
          );
          setStatus("error");
        });
    },
    [emit],
  );

  // -------------------------------------------------------------------------
  // Capture scheduling: requestVideoFrameCallback fires exactly once per
  // delivered camera frame; rAF polling remains as the fallback.
  // -------------------------------------------------------------------------
  const scheduleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!runningRef.current || !video) return;
    const session = sessionRef.current;

    const vfcVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        callback: (now: number, metadata: { mediaTime: number }) => void,
      ) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    if (typeof vfcVideo.requestVideoFrameCallback === "function") {
      vfcHandleRef.current = vfcVideo.requestVideoFrameCallback(() => {
        if (!runningRef.current || session !== sessionRef.current) return;
        lastFreshFrameMsRef.current = performance.now();
        cameraStalledRef.current = false;
        queueFrame(video);
        scheduleCapture();
      });
      return;
    }

    rafRef.current = requestAnimationFrame(() => {
      if (!runningRef.current || session !== sessionRef.current) return;
      const hasFreshFrame =
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastVideoTimeRef.current;
      if (hasFreshFrame) {
        lastVideoTimeRef.current = video.currentTime;
        lastFreshFrameMsRef.current = performance.now();
        cameraStalledRef.current = false;
        queueFrame(video);
      }
      scheduleCapture();
    });
  }, [queueFrame]);

  const cancelCapture = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const video = videoRef.current as
      | (HTMLVideoElement & { cancelVideoFrameCallback?: (handle: number) => void })
      | null;
    if (vfcHandleRef.current !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(vfcHandleRef.current);
    }
    vfcHandleRef.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Watchdog: independent of the capture loop, so a hung worker, a paused
  // rAF, or a stalled camera can never leave a stale DRIVE command streaming
  // through the 20 Hz heartbeat.
  // -------------------------------------------------------------------------
  const serviceWatchdog = useCallback(() => {
    if (!runningRef.current) return;
    const now = performance.now();

    if (now - lastResultAtRef.current > RESULT_STALL_MS) {
      framePendingRef.current = false;
      if (!stalledRef.current) {
        stalledRef.current = true;
        emit(STOP_COMMAND, "Gesture STOP");
        publishLive({
          ...liveRef.current,
          code: "S",
          name: "AI không phản hồi — xe đã dừng",
          throttle: 0,
          steering: 0,
          deflection: 0,
          stalled: true,
        });
      }
    }

    if (
      !cameraStalledRef.current &&
      now - lastFreshFrameMsRef.current > CAMERA_FRAME_TIMEOUT_MS
    ) {
      cameraStalledRef.current = true;
      resetRoles(true);
      setHandPresent(false);
      setDriveReady(false);
      publishLive({
        ...EMPTY_LIVE,
        name: "Camera không còn frame mới. Cần setup lại",
      });
    }

    // If the worker was recycled after repeated errors, restart the pipeline.
    if (!workerRef.current && runningRef.current) {
      runningRef.current = false;
      const session = sessionRef.current;
      void ensureWorker()
        .then(() => {
          if (sessionRef.current !== session) return;
          runningRef.current = true;
          lastResultAtRef.current = performance.now();
          scheduleCapture();
        })
        .catch((reason) => {
          emit(STOP_COMMAND, "Gesture STOP");
          setError(messageFrom(reason));
          setStatus("error");
        });
    }
  }, [emit, ensureWorker, publishLive, resetRoles, scheduleCapture]);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(serviceWatchdog, WATCHDOG_INTERVAL_MS);
    watchdogRef.current = timer;
    return () => {
      window.clearInterval(timer);
      if (watchdogRef.current === timer) watchdogRef.current = null;
    };
  }, [serviceWatchdog, status]);

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
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
      if (video.videoWidth && video.videoHeight) {
        videoAspectRef.current = video.videoWidth / video.videoHeight;
      }
      // The tracker converts planar x back to normalized x for the screen-side
      // test, so it has to be rebuilt whenever the camera geometry changes.
      trackerRef.current = new HandTracker(videoAspectRef.current);
      latencyMsRef.current = 0;

      resetRoles(false);
      sessionRef.current += 1;
      framePendingRef.current = false;
      detectErrorsRef.current = 0;
      workerRecycledRef.current = false;
      frameTimesRef.current = [];
      lastVideoTimeRef.current = -1;
      lastFreshFrameMsRef.current = performance.now();
      lastResultAtRef.current = performance.now();
      stalledRef.current = false;
      cameraStalledRef.current = false;
      runningRef.current = true;
      setStatus("ready");
      scheduleCapture();
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
  }, [delegate, ensureWorker, resetRoles, scheduleCapture]);

  const stop = useCallback(() => {
    runningRef.current = false;
    sessionRef.current += 1;
    framePendingRef.current = false;
    cancelCapture();
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
  }, [cancelCapture, resetRoles]);

  /**
   * Clear the emit-dedupe and gesture state without tearing the camera down.
   * App calls this on mode changes so a stale command can never survive a
   * MANUAL -> AUTO round trip.
   */
  const resetControlState = useCallback(() => {
    resetRoles(false);
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
    driveReady,
    fps,
    inferenceMs,
    pipelineLatencyMs,
    delegate,
    live,
    directionDeadZone: DEADZONE_ENTER_SPAN,
    start,
    stop,
    resetControlState,
  };
}
