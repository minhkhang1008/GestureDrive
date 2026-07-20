import { motion } from "motion/react";
import {
  VideoCamera,
  VideoCameraSlash,
  CircleNotch,
  Cube,
} from "@phosphor-icons/react";
import type { RefObject } from "react";
import type { TrackingStatus, LiveGesture } from "../hooks/useHandTracking";
import type { Mode } from "./ModeToggle";
import { COMMANDS } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: TrackingStatus;
  error: string | null;
  live: LiveGesture;
  handPresent: boolean;
  mode: Mode;
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
      className="flex items-center gap-2 rounded-[var(--radius-control)] bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110"
    >
      <VideoCamera size={16} weight="bold" />
      {label}
    </button>
  );
}

export function CameraPanel({
  videoRef,
  canvasRef,
  status,
  error,
  live,
  handPresent,
  mode,
  onStart,
}: Props) {
  const ready = status === "ready";
  const cmd = live.code ? COMMANDS[live.code] : null;

  return (
    <section className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4 lg:min-h-0 lg:flex-1">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold text-ink">Camera trực tiếp</h2>
        <span className="font-mono text-[11px] text-faint">
          MediaPipe Hand Landmarker
        </span>
      </div>

      <div className="relative aspect-video min-h-[300px] overflow-hidden rounded-xl bg-black lg:aspect-auto lg:min-h-0 lg:flex-1">
        {/* Video + landmark overlay. Video is mirrored; the overlay canvas is
            mirrored in its draw calls so the two stay aligned. */}
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

        {/* Vignette for overlay legibility */}
        {ready && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />
        )}

        {/* States */}
        {status === "idle" && (
          <Placeholder
            icon={<VideoCamera size={26} />}
            title="Camera đang tắt"
            body="Bật camera để mô hình AI đọc cử chỉ tay và sinh lệnh điều khiển theo thời gian thực."
            action={<StartButton onStart={onStart} label="Bật camera" />}
          />
        )}
        {status === "loading" && (
          <Placeholder
            icon={<CircleNotch size={26} className="animate-spin" />}
            title="Đang tải mô hình AI"
            body="Lần đầu có thể mất vài giây để tải mô hình nhận diện bàn tay."
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

        {/* Live overlays */}
        {ready && (
          <>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-sm">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-stop opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-stop" />
              </span>
              <span className="text-[11px] font-semibold tracking-wide text-white">
                LIVE
              </span>
            </div>

            {mode === "MANUAL" && (
              <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-sm">
                <span className="text-[11px] font-medium text-white/80">
                  AI tạm dừng
                </span>
              </div>
            )}

            {/* Gesture readout */}
            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] bg-black/50 px-2.5 py-2 backdrop-blur-sm">
                <span
                  className={`grid size-8 place-items-center rounded-lg ${
                    cmd
                      ? "bg-accent/20 text-accent"
                      : "bg-white/10 text-white/50"
                  }`}
                >
                  {cmd ? (
                    <CommandGlyph code={cmd.code} size={18} />
                  ) : (
                    <Cube size={16} />
                  )}
                </span>
                <div className="pr-1">
                  <p className="text-[13px] font-medium leading-tight text-white">
                    {mode === "MANUAL"
                      ? "Đang chờ nút bấm"
                      : handPresent
                        ? live.name
                        : "Không thấy bàn tay"}
                  </p>
                  <p className="font-mono text-[11px] leading-tight text-white/55">
                    {cmd ? `Lệnh ${cmd.code} · ${cmd.label}` : "Chưa có lệnh"}
                  </p>
                </div>
              </div>

              {mode === "AUTO" && handPresent && (
                <div className="flex w-28 flex-col gap-1 rounded-[var(--radius-control)] bg-black/50 px-3 py-2 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-white/50">
                      Độ ổn định
                    </span>
                    <span className="font-mono text-[11px] text-white">
                      {Math.round(live.confidence * 100)}%
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/15">
                    <motion.div
                      className="h-full rounded-full bg-accent"
                      animate={{ width: `${Math.round(live.confidence * 100)}%` }}
                      transition={{ duration: 0.2 }}
                    />
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
