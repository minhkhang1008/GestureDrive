import {
  Hand,
  Bluetooth,
  Broadcast,
  VideoCamera,
  Plugs,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";
import { ModeToggle, type Mode } from "./ModeToggle";
import type { SerialLink } from "../hooks/useSerialConnection";
import type { TrackingStatus } from "../hooks/useHandTracking";

function ConnectionStatus({ link }: { link: SerialLink }) {
  if (link.status === "connected") {
    const state =
      link.transport === "esp-now"
        ? { label: "ESP-NOW", icon: <Broadcast size={13} />, color: "text-ok" }
        : link.transport === "bluetooth"
          ? { label: "Bluetooth", icon: <Bluetooth size={13} />, color: "text-accent" }
          : link.transport === "none"
            ? { label: "Mất ESP2", icon: <Warning size={13} />, color: "text-stop" }
            : { label: "Đang dò ESP2", icon: <CircleNotch size={13} />, color: "text-dim" };
    return (
      <div className="hidden items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 sm:flex">
        <span className={state.color}>{state.icon}</span>
        <span className="text-[12px] font-medium text-ink">{state.label}</span>
        <span className="hidden font-mono text-[11px] text-faint md:inline">
          {link.portName}
        </span>
      </div>
    );
  }
  if (link.status === "connecting") {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 sm:flex">
        <CircleNotch size={13} className="animate-spin text-accent" />
        <span className="text-[12px] font-medium text-dim">Đang kết nối</span>
      </div>
    );
  }
  return null;
}

export function TopBar({
  link,
  mode,
  onModeChange,
  fps,
  trackingStatus,
}: {
  link: SerialLink;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  fps: number;
  trackingStatus: TrackingStatus;
}) {
  const isLinked = link.status === "connected";

  return (
    <header className="flex h-16 shrink-0 items-center gap-1.5 border-b border-line px-3 sm:gap-4 sm:px-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-[10px] border border-accent/40 bg-accent/10 text-accent">
          <Hand size={18} weight="bold" />
        </span>
        <div className="flex items-baseline gap-2">
          <span className="hidden text-[15px] font-semibold tracking-tight text-ink min-[430px]:inline">
            GestureDrive
          </span>
          <span className="hidden text-[12px] text-faint lg:inline">
            Điều khiển Micromouse
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {trackingStatus === "ready" && (
          <div className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 md:flex">
            <VideoCamera size={13} className="text-dim" />
            <span className="font-mono text-[11px] text-dim">{fps} FPS</span>
          </div>
        )}

        <ConnectionStatus link={link} />

        {isLinked ? (
          <button
            onClick={() => void link.disconnect()}
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[13px] font-medium text-dim transition-[color,border-color,transform] hover:border-line-strong hover:text-ink active:scale-[0.97]"
          >
            <Plugs size={15} />
            <span className="hidden sm:inline">Ngắt</span>
          </button>
        ) : (
          <button
            onClick={() => void link.connect()}
            disabled={link.status === "connecting"}
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-accent-strong px-3.5 py-1.5 text-[13px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
          >
            <Broadcast size={15} weight="bold" />
            <span className="hidden sm:inline">Kết nối ESP1</span>
            <span className="sm:hidden">Kết nối</span>
          </button>
        )}

        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>
    </header>
  );
}
