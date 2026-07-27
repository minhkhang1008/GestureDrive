import {
  CircleNotch,
  Cube,
  Gauge,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react";
import type { RefObject } from "react";
import type { LiveGesture, TrackingStatus } from "../hooks/useHandTracking";
import { COMMANDS } from "../lib/commands";
import type { ControlMode } from "../lib/controlTypes";
import type { HandLandmarkerDelegate } from "../lib/handLandmarkerWorkerProtocol";
import { CommandGlyph } from "./CommandGlyph";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: TrackingStatus;
  error: string | null;
  live: LiveGesture;
  handPresent: boolean;
  driveReady: boolean;
  inferenceMs: number;
  pipelineLatencyMs: number;
  delegate: HandLandmarkerDelegate | null;
  mode: ControlMode;
  /** Safety ceiling in force for AUTO, shown so it is never a hidden setting. */
  speedLimit: number;
  onStart: () => void;
}

function Placeholder({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="mb-4 grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-dim">
          {icon}
        </span>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{body}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function StartButton({ onStart, label }: { onStart: () => void; label: string }) {
  return (
    <button
      onClick={onStart}
      className="flex items-center gap-2 rounded-[var(--radius-control)] bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
    >
      <VideoCamera size={16} weight="bold" />
      {label}
    </button>
  );
}

type ChipTone = "accent" | "neutral" | "warn" | "stop";

const CHIP_BORDER: Record<ChipTone, string> = {
  accent: "border-accent/50",
  neutral: "border-white/10",
  warn: "border-warn/60",
  stop: "border-stop/60",
};

const CHIP_ICON: Record<ChipTone, string> = {
  accent: "bg-accent/25 text-accent",
  neutral: "bg-white/10 text-white/55",
  warn: "bg-warn/20 text-warn",
  stop: "bg-stop/25 text-stop",
};

export function CameraPanel({
  videoRef,
  canvasRef,
  status,
  error,
  live,
  handPresent,
  driveReady,
  inferenceMs,
  pipelineLatencyMs,
  delegate,
  mode,
  speedLimit,
  onStart,
}: Props) {
  const ready = status === "ready";
  const command = live.code ? COMMANDS[live.code] : null;

  // Gesture chip state: accent while driving, neutral while resting in the
  // dead zone, red whenever a safety condition has stopped the vehicle.
  const chipTone: ChipTone = (() => {
    if (mode !== "AUTO" || !ready) return "neutral";
    if (live.stalled) return "stop";
    if (live.setupStatus !== "ready") return "neutral";
    if (!handPresent || !driveReady) return "stop";
    if (live.reacquiring) return "stop";
    if (live.code && live.code !== "S") return "accent";
    return "neutral";
  })();

  return (
    <section className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold text-ink">Camera trực tiếp</h2>
        <span className="hidden font-mono text-[11px] text-faint sm:inline">
          {ready && delegate
            ? `${delegate} worker · AI ${inferenceMs.toFixed(1)} ms · tổng ${pipelineLatencyMs.toFixed(1)} ms`
            : "MediaPipe Hand Landmarker · worker · 1 tay"}
        </span>
      </div>

      <div className="relative aspect-video min-h-[300px] overflow-hidden rounded-xl bg-[#050507]">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 size-full -scale-x-100 object-cover ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 size-full object-cover ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />

        {ready && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/30" />
        )}

        {status === "idle" && (
          <Placeholder
            icon={<VideoCamera size={26} />}
            title="Camera đang tắt"
            body="Bật camera, giơ một bàn tay vào giữa khung hình rồi giữ yên để xác nhận tâm joystick."
            action={<StartButton onStart={onStart} label="Bật camera" />}
          />
        )}
        {status === "loading" && (
          <Placeholder
            icon={<CircleNotch size={26} className="animate-spin" />}
            title="Đang tải mô hình AI"
            body="Mô hình nhận diện bàn tay sẽ sẵn sàng sau vài giây."
          />
        )}
        {(status === "denied" || status === "no-camera" || status === "error") && (
          <Placeholder
            icon={<VideoCameraSlash size={26} className="text-stop" />}
            title={
              status === "denied"
                ? "Chưa được cấp quyền camera"
                : status === "no-camera"
                  ? "Không tìm thấy camera"
                  : "Không khởi động được camera"
            }
            body={error ?? "Đã xảy ra lỗi khi truy cập camera."}
            action={<StartButton onStart={onStart} label="Thử lại" />}
          />
        )}

        {ready && (
          <>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 backdrop-blur-sm">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-stop opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-stop" />
              </span>
              <span className="text-[10px] font-semibold tracking-wide text-white">LIVE</span>
            </div>

            {mode !== "AUTO" && (
              <div className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 backdrop-blur-sm">
                <span className="text-[10px] font-medium text-white/80">AI tạm dừng</span>
              </div>
            )}

            {mode === "AUTO" && live.stalled && (
              <div className="absolute inset-x-0 top-0 bg-stop px-4 py-1.5 text-center text-[11px] font-bold text-white">
                AI không phản hồi — xe đã dừng
              </div>
            )}

            {/* A rejected landmark jump: the tracker is rebuilding confidence
                in where the hand actually is, and refuses to drive until it
                has. Distinct from a stall, which means no results at all. */}
            {mode === "AUTO" && !live.stalled && live.reacquiring && (
              <div className="absolute inset-x-0 top-0 bg-stop px-4 py-1.5 text-center text-[11px] font-bold text-white">
                Đang bắt lại bàn tay — xe đã dừng
              </div>
            )}

            {mode === "AUTO" && live.setupStatus !== "ready" && (
              <div className="absolute left-1/2 top-14 w-[min(88%,430px)] -translate-x-1/2 rounded-[var(--radius-control)] border border-accent/30 bg-black/65 px-4 py-3 text-center backdrop-blur-sm">
                <p className="text-[13px] font-semibold text-white">{live.name}</p>
                <p className="mt-1 text-[11px] text-white/60">
                  Giơ một bàn tay vào giữa khung hình rồi giữ yên tới khi vòng
                  tròn chạy đủ. Điểm đó thành tâm joystick.
                </p>
                {live.setupStatus === "arming" && (
                  <div
                    className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/15"
                    role="progressbar"
                    aria-label="Tiến trình xác nhận tâm joystick"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(live.armProgress * 100)}
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-100"
                      style={{ width: `${live.armProgress * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
              <div
                className={`flex min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] border bg-black/55 px-2.5 py-2 backdrop-blur-sm ${CHIP_BORDER[chipTone]}`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg ${CHIP_ICON[chipTone]}`}
                >
                  {command ? (
                    <CommandGlyph code={command.code} size={18} />
                  ) : (
                    <Cube size={16} />
                  )}
                </span>
                <div className="min-w-0 pr-1">
                  <p className="truncate text-[13px] font-medium leading-tight text-white">
                    {mode !== "AUTO"
                      ? "Đang chờ nút bấm"
                      : handPresent
                        ? live.name
                        : "Không thấy bàn tay"}
                  </p>
                  <p className="font-mono text-[10px] leading-tight text-white/55">
                    ổn định {Math.round(live.confidence * 100)}%
                    {live.setupStatus === "ready" &&
                      ` · bám tay ${Math.round(live.quality * 100)}%`}
                    {live.setupStatus === "ready" &&
                      ` · ga ${live.throttle > 0 ? "+" : ""}${live.throttle} · lái ${
                        live.steering > 0 ? "+" : ""
                      }${live.steering}`}
                  </p>
                </div>
              </div>

              {mode === "AUTO" && (
                <div className="flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-sm">
                  <Gauge size={15} className="text-accent" />
                  <div>
                    <p className="font-mono text-[12px] font-semibold text-white">
                      LIMIT {speedLimit}
                    </p>
                    <p className="text-[10px] text-white/55">
                      {Math.round(speedLimit / 10)}% công suất
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
