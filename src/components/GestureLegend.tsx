import {
  ArrowsOutCardinal,
  HandFist,
  HandPalm,
  LockSimple,
} from "@phosphor-icons/react";
import { COMMAND_ORDER, COMMANDS } from "../lib/commands";
import { CommandGlyph } from "./CommandGlyph";

function Step({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2.5">
      <span className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
        {icon}
      </span>
      <p className="text-[11px] leading-relaxed text-dim">
        <span className="font-medium text-ink">{title}</span> {body}
      </p>
    </div>
  );
}

/** Two rings + live vector: the analog joystick the overlay draws on camera. */
function JoystickDiagram() {
  return (
    <svg
      viewBox="0 0 200 158"
      className="w-full max-w-[200px]"
      role="img"
      aria-label="Sơ đồ joystick ảo: vòng nhỏ là vùng dừng, kéo tay ra xa để tăng ga và lái, vòng ngoài là mức tối đa"
    >
      {/* Full-deflection ring */}
      <circle
        cx="100"
        cy="82"
        r="64"
        fill="none"
        stroke="var(--color-accent)"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeDasharray="6 6"
      />
      {/* Dead zone ring */}
      <circle
        cx="100"
        cy="82"
        r="21"
        fill="rgb(255 255 255 / 0.04)"
        stroke="var(--color-dim)"
        strokeOpacity="0.8"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      {/* Displacement vector: anchor -> palm */}
      <line
        x1="100"
        y1="82"
        x2="144"
        y2="47"
        stroke="var(--color-accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="100" cy="82" r="4" fill="var(--color-accent)" />
      <circle
        cx="144"
        cy="47"
        r="7"
        fill="var(--color-accent)"
        stroke="var(--color-bg)"
        strokeWidth="2"
      />
      {/* Labels */}
      <text
        x="100"
        y="115"
        textAnchor="middle"
        fontSize="10"
        fill="var(--color-dim)"
      >
        vùng dừng
      </text>
      <text x="38" y="150" fontSize="10" fill="var(--color-faint)">
        vòng ngoài = tối đa
      </text>
      <text x="128" y="32" fontSize="10" fill="var(--color-accent)">
        ga + lái
      </text>
    </svg>
  );
}

export function GestureLegend() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="mb-3 text-[12px] font-medium text-dim">
        Điều khiển analog bằng hai tay
      </p>

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <div className="grid min-w-0 flex-1 content-start gap-2">
          <Step
            icon={<HandPalm size={15} weight="bold" />}
            title="1. Xác nhận vai trò:"
            body="đặt hai tay ở hai nửa khung hình — tay xòe = điều hướng, tay nắm = tốc độ. Giữ yên vài nhịp để xác nhận."
          />
          <Step
            icon={<ArrowsOutCardinal size={15} weight="bold" />}
            title="2. Joystick ảo tỉ lệ:"
            body="vòng nhỏ quanh điểm neo là vùng dừng. Kéo tay điều hướng ra ngoài — ga và lái tăng tỉ lệ theo khoảng cách kéo, chạm vòng ngoài là tối đa. Hướng lòng bàn tay vào camera để tiến, mu bàn tay để lùi."
          />
          <Step
            icon={
              <>
                <HandFist size={15} weight="bold" />
                <LockSimple
                  size={8}
                  weight="fill"
                  className="absolute bottom-0.5 right-0.5"
                />
              </>
            }
            title="3. Kéo tốc độ:"
            body="chụm ngón cái–trỏ rồi kéo dọc để chỉnh LIMIT (kéo tương đối so với điểm chụm). Thả chụm để khóa mức hiện tại. Đặt xong có thể hạ tay tốc độ xuống — mức đã chọn vẫn được giữ và xe chạy bằng một tay điều hướng."
          />
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] bg-surface-2 px-4 py-3 md:w-[224px]">
          <JoystickDiagram />
        </div>
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3"
        aria-label="Tám hướng theo góc kéo"
      >
        <span className="text-[10px] uppercase tracking-[0.08em] text-faint">
          8 hướng
        </span>
        {COMMAND_ORDER.filter((code) => code !== "S").map((code) => (
          <span
            key={code}
            className="flex items-center gap-1 text-[10px] text-dim"
          >
            <span className="text-accent">
              <CommandGlyph code={code} size={11} />
            </span>
            {COMMANDS[code].label}
          </span>
        ))}
      </div>
    </div>
  );
}
