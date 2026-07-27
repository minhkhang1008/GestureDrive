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

export interface OneEuroOptions {
  /** Cutoff at zero speed. Lower = smoother but laggier when still. */
  minCutoffHz?: number;
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta?: number;
  /** Cutoff for the derivative estimate. */
  derivativeCutoffHz?: number;
}

function smoothingAlpha(cutoffHz: number, deltaSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / deltaSeconds);
}

/**
 * One-Euro filter (Casiez et al. 2012): adaptive low-pass that stays smooth on
 * a near-still hand yet tracks fast movement with minimal lag. This is the
 * standard filter for pointer-like control from noisy landmarks.
 */
export class OneEuroFilter {
  private readonly minCutoffHz: number;
  private readonly beta: number;
  private readonly derivativeCutoffHz: number;
  private lastValue: number | null = null;
  private lastDerivative = 0;
  private lastTimeMs: number | null = null;

  constructor(options: OneEuroOptions = {}) {
    this.minCutoffHz = options.minCutoffHz ?? 1.2;
    this.beta = options.beta ?? 0.025;
    this.derivativeCutoffHz = options.derivativeCutoffHz ?? 1.0;
  }

  reset(): void {
    this.lastValue = null;
    this.lastDerivative = 0;
    this.lastTimeMs = null;
  }

  /**
   * Smoothed derivative in input units per second. The filter already
   * maintains it to drive the adaptive cutoff, so reusing it for latency
   * compensation costs nothing and stays consistent with the filtered value.
   */
  velocity(): number {
    return this.lastDerivative;
  }

  filter(value: number, timeMs: number): number {
    if (
      this.lastValue === null ||
      this.lastTimeMs === null ||
      timeMs <= this.lastTimeMs
    ) {
      this.lastValue = value;
      this.lastTimeMs = timeMs;
      this.lastDerivative = 0;
      return value;
    }

    const deltaSeconds = (timeMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = timeMs;

    const rawDerivative = (value - this.lastValue) / deltaSeconds;
    const derivativeAlpha = smoothingAlpha(this.derivativeCutoffHz, deltaSeconds);
    this.lastDerivative = ema(this.lastDerivative, rawDerivative, derivativeAlpha);

    const cutoffHz = this.minCutoffHz + this.beta * Math.abs(this.lastDerivative);
    const alpha = smoothingAlpha(cutoffHz, deltaSeconds);
    this.lastValue = ema(this.lastValue, value, alpha);
    return this.lastValue;
  }
}

/** Independent One-Euro filters for the two axes of a 2D point. */
export class OneEuroPointFilter {
  private readonly x: OneEuroFilter;
  private readonly y: OneEuroFilter;

  constructor(options: OneEuroOptions = {}) {
    this.x = new OneEuroFilter(options);
    this.y = new OneEuroFilter(options);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
  }

  /** Smoothed 2D velocity in input units per second. */
  velocity(): { x: number; y: number } {
    return { x: this.x.velocity(), y: this.y.velocity() };
  }

  filter(point: { x: number; y: number }, timeMs: number): { x: number; y: number } {
    return { x: this.x.filter(point.x, timeMs), y: this.y.filter(point.y, timeMs) };
  }
}
