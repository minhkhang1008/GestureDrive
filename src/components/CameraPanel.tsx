import {
  CircleNotch,
  Cube,
  Gauge,
  LockSimple,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react";
import type { RefObject } from "react";
import type { LiveGesture, TrackingStatus } from "../hooks/useHandTracking";
import { COMMANDS } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";
import type { Mode } from "./ModeToggle";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: TrackingStatus;
  error: string | null;
  live: LiveGesture;
  handPresent: boolean;
  bothHandsPresent: boolean;
  directionDeadZone: number;
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
      className="flex items-center gap-2 rounded-[var(--radius-control)] bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
    >
      <VideoCamera size={16} weight="bold" />
      {label}
    </button>
  );
}

function RoleLabel({
  side,
  label,
}: {
  side: "left" | "right";
  label: string;
}) {
  return (
    <span
      className={`absolute top-3 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 font-mono text-[10px] font-semibold text-white/80 backdrop-blur-sm ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      {label}
    </span>
  );
}

export function CameraPanel({
  videoRef,
  canvasRef,
  status,
  error,
  live,
  handPresent,
  bothHandsPresent,
  directionDeadZone,
  mode,
  onStart,
}: Props) {
  const ready = status === "ready";
  const command = live.code ? COMMANDS[live.code] : null;
  const speedTop = `${(1 - live.speed / 255) * 100}%`;

  return (
    <section className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4 lg:min-h-0 lg:flex-1">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold text-ink">Camera trực tiếp</h2>
        <span className="font-mono text-[11px] text-faint">
          MediaPipe, tối đa 2 tay
        </span>
      </div>

      <div className="relative aspect-video min-h-[300px] overflow-hidden rounded-xl bg-[#050507] lg:aspect-auto lg:min-h-0 lg:flex-1">
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
            body="Bật camera, đặt hai tay ở hai bên và thực hiện thao tác xòe - nắm để xác nhận vai trò."
            action={<StartButton onStart={onStart} label="Bật camera" />}
          />
        )}
        {status === "loading" && (
          <Placeholder
            icon={<CircleNotch size={26} className="animate-spin" />}
            title="Đang tải mô hình AI"
            body="Mô hình nhận diện hai tay sẽ sẵn sàng sau vài giây."
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
            {mode === "AUTO" && live.roles ? (
              <>
                <RoleLabel side={live.roles.control} label="TAY ĐIỀU HƯỚNG" />
                <RoleLabel side={live.roles.speed} label="TAY TỐC ĐỘ" />
              </>
            ) : (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 backdrop-blur-sm">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-stop opacity-70" />
                  <span className="relative inline-flex size-2 rounded-full bg-stop" />
                </span>
                <span className="text-[10px] font-semibold tracking-wide text-white">LIVE</span>
              </div>
            )}

            {mode === "MANUAL" && (
              <div className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 backdrop-blur-sm">
                <span className="text-[10px] font-medium text-white/80">AI tạm dừng</span>
              </div>
            )}

            {mode === "AUTO" && live.setupStatus !== "ready" && (
              <div className="absolute left-1/2 top-14 w-[min(88%,430px)] -translate-x-1/2 rounded-[var(--radius-control)] border border-accent/30 bg-black/65 px-4 py-3 text-center backdrop-blur-sm">
                <p className="text-[13px] font-semibold text-white">{live.name}</p>
                <p className="mt-1 text-[11px] text-white/60">
                  Tay xòe = điều hướng, tay nắm = tốc độ. Giữ hai tay ở hai nửa màn hình.
                </p>
              </div>
            )}

            {mode === "AUTO" && live.setupStatus === "ready" && live.controlAnchor && (
              <>
                <span
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-accent/70 bg-accent/10"
                  style={{
                    left: `${live.controlAnchor.x * 100}%`,
                    top: `${live.controlAnchor.y * 100}%`,
                    width: `${directionDeadZone * 200}%`,
                    aspectRatio: "1",
                  }}
                  aria-hidden="true"
                />

                <div
                  className={`absolute bottom-[14%] top-[14%] w-8 rounded-full border border-white/15 bg-black/45 backdrop-blur-sm ${
                    live.roles?.speed === "left" ? "left-4" : "right-4"
                  }`}
                >
                  <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[8px] font-medium text-white/45">
                    MAX
                  </span>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-medium text-white/45">
                    0
                  </span>
                  <span
                    className="absolute left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent transition-[top] duration-150"
                    style={{ top: speedTop }}
                  />
                </div>
              </>
            )}

            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] border border-white/10 bg-black/55 px-2.5 py-2 backdrop-blur-sm">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                    command ? "bg-accent/20 text-accent" : "bg-white/10 text-white/50"
                  }`}
                >
                  {command ? (
                    <CommandGlyph code={command.code} size={18} />
                  ) : (
                    <Cube size={16} />
                  )}
                </span>
                <div className="min-w-0 pr-1">
                  <p className="truncate text-[13px] font-medium leading-tight text-white">
                    {mode === "MANUAL"
                      ? "Đang chờ nút bấm"
                      : handPresent
                        ? live.name
                        : "Không thấy bàn tay"}
                  </p>
                  <p className="font-mono text-[10px] leading-tight text-white/55">
                    {live.handCount}/2 tay, ổn định {Math.round(live.confidence * 100)}%
                  </p>
                </div>
              </div>

              {mode === "AUTO" && live.setupStatus === "ready" && (
                <div className="flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-sm">
                  {live.speedLocked ? (
                    <LockSimple size={15} className="text-white/65" />
                  ) : (
                    <Gauge size={15} className="text-accent" />
                  )}
                  <div>
                    <p className="font-mono text-[12px] font-semibold text-white">
                      PWM {live.speed}
                    </p>
                    <p className="text-[9px] text-white/50">
                      {!bothHandsPresent
                        ? "Thiếu tay"
                        : live.speedState === "adjusting"
                          ? "Đang kéo"
                          : live.speedLocked
                            ? "Đã khóa"
                            : "Chưa đúng cử chỉ"}
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
