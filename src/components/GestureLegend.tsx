import { ArrowsOutCardinal, Gauge, HandPalm, Warning } from "@phosphor-icons/react";
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

export function GestureLegend({
  speedLimit,
  onSpeedLimitChange,
}: {
  speedLimit: number;
  onSpeedLimitChange: (speedLimit: number) => void;
}) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-medium text-dim">
          Điều khiển analog bằng một tay
        </p>
        <span className="font-mono text-[11px] text-accent">LIMIT {speedLimit}</span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <div className="grid min-w-0 flex-1 content-start gap-2">
          <Step
            icon={<HandPalm size={15} weight="bold" />}
            title="1. Xác nhận tâm:"
            body="giơ một bàn tay vào giữa khung hình rồi giữ yên khoảng 0,6 giây. Vòng tròn quanh bàn tay chạy đủ một vòng là tâm joystick được chốt tại đó. Đứng quá sát rìa khung hình sẽ không chốt được, vì sẽ không còn đường kéo về phía đó."
          />
          <Step
            icon={<ArrowsOutCardinal size={15} weight="bold" />}
            title="2. Kéo để chạy:"
            body="vòng nhỏ quanh tâm là vùng dừng. Kéo tay ra xa — kéo lên là tiến, xuống là lùi, trái phải là bẻ lái. Càng xa tâm càng nhanh, chạm vòng ngoài là tối đa."
          />
          <Step
            icon={<Gauge size={15} weight="bold" />}
            title="3. Giới hạn an toàn:"
            body="thanh LIMIT bên dưới chặn trần công suất gửi xuống xe. Để 600 khi chạy trong nhà, hạ xuống 300-400 khi demo gần người xem."
          />
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] bg-surface-2 px-4 py-3 md:w-[224px]">
          <JoystickDiagram />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2.5">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-dim">
          <Gauge size={14} /> Giới hạn
        </span>
        <input
          type="range"
          min="0"
          max="1000"
          step="25"
          value={speedLimit}
          onChange={(event) => onSpeedLimitChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-accent"
          aria-label="Giới hạn tốc độ chế độ AUTO"
        />
        <span className="w-24 shrink-0 text-right font-mono text-[10px] text-faint">
          {Math.round(speedLimit / 10)}% công suất
        </span>
      </label>

      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-faint">
        <Warning size={12} className="mt-0.5 shrink-0" />
        Đổi giới hạn sẽ tự gửi STOP trước, nên xe luôn dừng một nhịp rồi mới nhận
        mức mới.
      </p>

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
