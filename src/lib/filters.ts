export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRange(
  value: number,
  inputMin: number,
  inputMax: number,
): number {
  if (inputMin === inputMax) return 0;
  return clamp((value - inputMin) / (inputMax - inputMin), 0, 1);
}

export function applyDeadzone(value: number, deadzone: number): number {
  const zone = clamp(Math.abs(deadzone), 0, 0.999);
  const magnitude = Math.abs(value);
  if (magnitude <= zone) return 0;
  return Math.sign(value) * clamp((magnitude - zone) / (1 - zone), 0, 1);
}

export function applyRadialDeadzone(
  x: number,
  y: number,
  deadzone: number,
): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  const filteredMagnitude = applyDeadzone(magnitude, deadzone);
  if (filteredMagnitude === 0 || magnitude === 0) return { x: 0, y: 0 };
  const scale = filteredMagnitude / magnitude;
  return { x: clamp(x * scale, -1, 1), y: clamp(y * scale, -1, 1) };
}

export function hysteresisActive(
  magnitude: number,
  wasActive: boolean,
  enterThreshold = 0.12,
  exitThreshold = 0.08,
): boolean {
  const value = Math.abs(magnitude);
  return wasActive ? value > exitThreshold : value >= enterThreshold;
}

export function ema(previous: number, next: number, alpha = 0.3): number {
  const weight = clamp(alpha, 0, 1);
  return previous + weight * (next - previous);
}
